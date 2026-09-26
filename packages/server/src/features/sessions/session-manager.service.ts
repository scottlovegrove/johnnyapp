import { randomUUID } from 'node:crypto'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { Injectable } from '@nestjs/common'
import type {
    PermissionRequest,
    Project,
    ServerMessage,
    SessionInfo,
    TranscriptItem,
} from '@johnny/shared'
import { AgentRegistryService } from '../agents/agent-registry.service'
import type { AgentEvents } from '../agents/agent.types'

interface Session {
    info: SessionInfo
    transcript: TranscriptItem[]
    pending: (PermissionRequest & { resolve: (optionId: string | null) => void }) | null
}

export type Subscriber = (msg: ServerMessage) => void

const now = () => new Date().toISOString()

/** ACP RequestErrors carry the useful text in `data.details`; prefer that. */
export function errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'data' in err) {
        const data = (err as { data?: { details?: unknown } }).data
        if (data && typeof data.details === 'string') return data.details
    }
    return err instanceof Error ? err.message : String(err)
}

/**
 * Owns all chat sessions, routes agent events into per-session transcripts and
 * fans them out to subscribers.
 */
@Injectable()
export class SessionManagerService {
    private readonly sessions = new Map<string, Session>()
    private readonly subscribers = new Map<string, Set<Subscriber>>()
    private readonly globalSubscribers = new Set<Subscriber>()
    private readonly agents: AgentRegistryService

    constructor(agents: AgentRegistryService) {
        this.agents = agents
    }

    list(): SessionInfo[] {
        return [...this.sessions.values()].map((s) => ({ ...s.info }))
    }

    get(sessionId: string): SessionInfo | undefined {
        const session = this.sessions.get(sessionId)
        return session ? { ...session.info } : undefined
    }

    async create(agentId: string, project: Project): Promise<SessionInfo> {
        const adapter = await this.agents.get(agentId, this.agentEvents(agentId))
        const id = await adapter.newSession(project.path)
        const info: SessionInfo = {
            id,
            agentId,
            projectId: project.id,
            cwd: project.path,
            title: `Session ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
            createdAt: now(),
            busy: false,
        }
        this.sessions.set(id, { info, transcript: [], pending: null })
        for (const sub of this.globalSubscribers) sub({ type: 'session', session: { ...info } })
        return info
    }

    async prompt(sessionId: string, text: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) throw new Error('Unknown session')
        if (session.info.busy) throw new Error('Session is busy')

        session.info.busy = true
        this.emit(sessionId, { type: 'session', session: { ...session.info } })
        this.push(session, { kind: 'user', id: randomUUID(), text, at: now() })

        try {
            const adapter = await this.agents.get(
                session.info.agentId,
                this.agentEvents(session.info.agentId),
            )
            const stopReason = await adapter.prompt(sessionId, text)
            this.push(session, { kind: 'turn_end', id: randomUUID(), stopReason, at: now() })
        } catch (err) {
            this.push(session, {
                kind: 'error',
                id: randomUUID(),
                message: errorMessage(err),
                at: now(),
            })
        } finally {
            session.info.busy = false
            this.emit(sessionId, { type: 'session', session: { ...session.info } })
        }
    }

    async cancel(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session?.info.busy) return
        if (session.pending) this.resolvePermission(session.pending.requestId, null)
        const adapter = await this.agents.get(
            session.info.agentId,
            this.agentEvents(session.info.agentId),
        )
        await adapter.cancel(sessionId)
    }

    resolvePermission(requestId: string, optionId: string | null): boolean {
        for (const session of this.sessions.values()) {
            if (session.pending?.requestId !== requestId) continue
            session.pending.resolve(optionId)
            session.pending = null
            this.emit(session.info.id, { type: 'permission_resolved', requestId })
            return true
        }
        return false
    }

    /** Receive a session's transcript now and every later event for it. */
    subscribe(sessionId: string, sub: Subscriber): () => void {
        const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>()
        this.subscribers.set(sessionId, set)
        set.add(sub)

        const session = this.sessions.get(sessionId)
        if (session) {
            let pending: PermissionRequest | null = null
            if (session.pending) {
                const { resolve: _resolve, ...request } = session.pending
                pending = request
            }
            sub({ type: 'transcript', sessionId, items: session.transcript, pending })
        }
        return () => set.delete(sub)
    }

    /** Receive session-level events (new sessions) regardless of subscription. */
    subscribeAll(sub: Subscriber): () => void {
        this.globalSubscribers.add(sub)
        return () => this.globalSubscribers.delete(sub)
    }

    private agentEvents(agentId: string): AgentEvents {
        return {
            update: (sessionId, update) => this.onUpdate(sessionId, update),
            permission: (sessionId, toolCall, options) =>
                new Promise((resolve) => {
                    const session = this.sessions.get(sessionId)
                    if (!session) return resolve(null)
                    const request: PermissionRequest = {
                        requestId: randomUUID(),
                        sessionId,
                        toolCall,
                        options,
                    }
                    session.pending = { ...request, resolve }
                    this.emit(sessionId, { type: 'permission_request', request })
                }),
            closed: (err) => this.onAgentClosed(agentId, err),
        }
    }

    private onAgentClosed(agentId: string, err: unknown): void {
        const message = `Agent "${agentId}" disconnected${err instanceof Error ? `: ${err.message}` : ''}`
        for (const s of this.sessions.values()) {
            if (s.info.agentId !== agentId) continue
            if (s.pending) {
                s.pending.resolve(null)
                s.pending = null
            }
            if (s.info.busy) {
                s.info.busy = false
                this.push(s, { kind: 'error', id: randomUUID(), message, at: now() })
                this.emit(s.info.id, { type: 'session', session: { ...s.info } })
            }
        }
    }

    private onUpdate(sessionId: string, update: SessionUpdate): void {
        const session = this.sessions.get(sessionId)
        if (!session) return
        this.push(session, { kind: 'update', id: randomUUID(), update, at: now() })
    }

    private push(session: Session, item: TranscriptItem): void {
        session.transcript.push(item)
        this.emit(session.info.id, { type: 'item', sessionId: session.info.id, item })
    }

    private emit(sessionId: string, msg: ServerMessage): void {
        for (const sub of this.subscribers.get(sessionId) ?? []) sub(msg)
    }
}
