import { randomUUID } from 'node:crypto'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { Injectable, Logger } from '@nestjs/common'
import type {
    PermissionRequest,
    Project,
    ServerMessage,
    SessionInfo,
    TranscriptItem,
} from '@johnny/shared'
import { AgentRegistryService } from '../agents/agent-registry.service'
import type { AgentAdapter, AgentEvents } from '../agents/agent.types'
import { SessionStoreService } from './session-store.service'

interface Session {
    info: SessionInfo
    transcript: TranscriptItem[]
    pending: (PermissionRequest & { resolve: (optionId: string | null) => void }) | null
    /** The agent process running now knows this session. */
    attached: boolean
    /** The transcript in memory is complete; only true for sessions created here or already replayed. */
    historyLoaded: boolean
    /** In-flight attach, so concurrent callers share one load. */
    attaching: Promise<void> | null
    /** History is being replayed by `loadSession`; items are recorded silently. */
    replaying: boolean
    /** `messageId` of the user message currently being reassembled from chunks. */
    replayUserMessageId: string | null
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

function defaultTitle(): string {
    return `Session ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Owns all chat sessions, routes agent events into per-session transcripts and
 * fans them out to subscribers. Sessions are indexed on disk; after a restart
 * they are re-attached to the agent lazily, replaying history on first use.
 */
@Injectable()
export class SessionManagerService {
    private readonly logger = new Logger(SessionManagerService.name)
    private readonly sessions = new Map<string, Session>()
    private readonly subscribers = new Map<string, Set<Subscriber>>()
    private readonly globalSubscribers = new Set<Subscriber>()
    private readonly agents: AgentRegistryService
    private readonly store: SessionStoreService

    constructor(agents: AgentRegistryService, store: SessionStoreService) {
        this.agents = agents
        this.store = store
        for (const record of store.list()) {
            this.sessions.set(record.id, this.newSession({ ...record, busy: false }, false))
        }
    }

    list(): SessionInfo[] {
        return [...this.sessions.values()].map((s) => ({ ...s.info }))
    }

    get(sessionId: string): SessionInfo | undefined {
        const session = this.sessions.get(sessionId)
        return session ? { ...session.info } : undefined
    }

    async create(agentId: string, project: Project): Promise<SessionInfo> {
        const adapter = await this.adapter(agentId)
        const id = await adapter.newSession(project.path)
        const at = now()
        const info: SessionInfo = {
            id,
            agentId,
            projectId: project.id,
            cwd: project.path,
            title: defaultTitle(),
            createdAt: at,
            lastActiveAt: at,
            origin: 'johnny',
            busy: false,
        }
        this.sessions.set(id, this.newSession(info, true))
        this.store.upsert(info)
        this.announce(info)
        return { ...info }
    }

    /**
     * Pull in sessions the agent already has for a project (started from its
     * own CLI, or from Johnny before its index existed). Returns the new ones.
     */
    async importFromAgent(agentId: string, project: Project): Promise<SessionInfo[]> {
        const adapter = await this.adapter(agentId)
        const added: SessionInfo[] = []
        for (const summary of await adapter.listSessions(project.path)) {
            if (this.sessions.has(summary.id)) continue
            const at = summary.updatedAt ?? now()
            const info: SessionInfo = {
                id: summary.id,
                agentId,
                projectId: project.id,
                cwd: project.path,
                title: summary.title?.trim() || defaultTitle(),
                createdAt: at,
                lastActiveAt: at,
                origin: 'agent',
                busy: false,
            }
            this.sessions.set(info.id, this.newSession(info, false))
            this.store.upsert(info)
            this.announce(info)
            added.push({ ...info })
        }
        return added
    }

    remove(sessionId: string): boolean {
        const session = this.sessions.get(sessionId)
        if (!session) return false
        session.pending?.resolve(null)
        this.sessions.delete(sessionId)
        this.subscribers.delete(sessionId)
        this.store.remove(sessionId)
        return true
    }

    async prompt(sessionId: string, text: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) throw new Error('Unknown session')
        if (session.info.busy) throw new Error('Session is busy')

        session.info.busy = true
        session.info.lastActiveAt = now()
        this.store.upsert(session.info)
        this.emit(sessionId, { type: 'session', session: { ...session.info } })

        try {
            // Re-attach first so any replayed history lands before this message.
            await this.ensureAttached(session)
            this.push(session, { kind: 'user', id: randomUUID(), text, at: now() })
            const adapter = await this.adapter(session.info.agentId)
            const stopReason = await adapter.prompt(sessionId, text)
            this.push(session, { kind: 'turn_end', id: randomUUID(), stopReason, at: now() })
            await this.refreshTitle(session, adapter)
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
        const adapter = await this.adapter(session.info.agentId)
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

    /**
     * Receive a session's transcript now and every later event for it. A
     * session from a previous run is re-attached in the background and the
     * replayed transcript delivered when it is ready.
     */
    subscribe(sessionId: string, sub: Subscriber): () => void {
        const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>()
        this.subscribers.set(sessionId, set)
        set.add(sub)

        const session = this.sessions.get(sessionId)
        if (session) {
            sub(this.transcriptMessage(session))
            if (!session.attached) {
                this.ensureAttached(session).catch((err) => {
                    this.push(session, {
                        kind: 'error',
                        id: randomUUID(),
                        message: `Could not resume session: ${errorMessage(err)}`,
                        at: now(),
                    })
                })
            }
        }
        return () => set.delete(sub)
    }

    /** Receive session-level events (new sessions) regardless of subscription. */
    subscribeAll(sub: Subscriber): () => void {
        this.globalSubscribers.add(sub)
        return () => this.globalSubscribers.delete(sub)
    }

    private newSession(info: SessionInfo, attached: boolean): Session {
        return {
            info,
            transcript: [],
            pending: null,
            attached,
            historyLoaded: attached,
            attaching: null,
            replaying: false,
            replayUserMessageId: null,
        }
    }

    private adapter(agentId: string): Promise<AgentAdapter> {
        return this.agents.get(agentId, this.agentEvents(agentId))
    }

    private ensureAttached(session: Session): Promise<void> {
        if (session.attached) return Promise.resolve()
        session.attaching ??= this.attach(session).finally(() => {
            session.attaching = null
        })
        return session.attaching
    }

    private async attach(session: Session): Promise<void> {
        const adapter = await this.adapter(session.info.agentId)
        const { id, cwd } = session.info
        if (!session.historyLoaded && adapter.capabilities.loadSession) {
            session.replaying = true
            try {
                await adapter.loadSession(id, cwd)
            } finally {
                session.replaying = false
                session.replayUserMessageId = null
            }
            session.historyLoaded = true
        } else if (adapter.capabilities.resumeSession) {
            await adapter.resumeSession(id, cwd)
        } else {
            throw new Error(`${adapter.name} cannot resume earlier sessions`)
        }
        session.attached = true
        this.emit(id, this.transcriptMessage(session))
    }

    /** Adopt the agent's own title for the session once it has one. */
    private async refreshTitle(session: Session, adapter: AgentAdapter): Promise<void> {
        if (!adapter.capabilities.listSessions) return
        try {
            const summary = (await adapter.listSessions(session.info.cwd)).find(
                (s) => s.id === session.info.id,
            )
            const title = summary?.title?.trim()
            if (!title || title === session.info.title) return
            session.info.title = title
            this.store.upsert(session.info)
            this.announce(session.info)
        } catch (err) {
            this.logger.debug(`title refresh failed: ${errorMessage(err)}`)
        }
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
            s.attached = false
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

        // The agent's own copy of what the user said (replayed history, or
        // echoed input) becomes a user bubble rather than a raw update. Chunks
        // of one message share a messageId and are stitched back together.
        if (update.sessionUpdate === 'user_message_chunk') {
            const text = update.content.type === 'text' ? update.content.text : ''
            const messageId = update.messageId ?? null
            const last = session.transcript.at(-1)
            if (
                last?.kind === 'user' &&
                messageId !== null &&
                messageId === session.replayUserMessageId
            ) {
                last.text += text
                return
            }
            session.replayUserMessageId = messageId
            this.push(session, { kind: 'user', id: randomUUID(), text, at: now() })
            return
        }
        session.replayUserMessageId = null
        this.push(session, { kind: 'update', id: randomUUID(), update, at: now() })
    }

    private push(session: Session, item: TranscriptItem): void {
        session.transcript.push(item)
        // Replayed history is delivered in one transcript message once the
        // load completes, not item by item.
        if (session.replaying) return
        this.emit(session.info.id, { type: 'item', sessionId: session.info.id, item })
    }

    private transcriptMessage(session: Session): ServerMessage {
        let pending: PermissionRequest | null = null
        if (session.pending) {
            const { resolve: _resolve, ...request } = session.pending
            pending = request
        }
        return {
            type: 'transcript',
            sessionId: session.info.id,
            items: [...session.transcript],
            pending,
        }
    }

    private announce(info: SessionInfo): void {
        for (const sub of this.globalSubscribers) sub({ type: 'session', session: { ...info } })
    }

    private emit(sessionId: string, msg: ServerMessage): void {
        for (const sub of this.subscribers.get(sessionId) ?? []) sub(msg)
    }
}
