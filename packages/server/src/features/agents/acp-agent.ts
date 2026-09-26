import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
    type ClientConnection,
    type ClientContext,
    client,
    methods,
    ndJsonStream,
    PROTOCOL_VERSION,
    type StopReason,
} from '@agentclientprotocol/sdk'
import { Logger } from '@nestjs/common'
import type {
    AcpAgentSpec,
    AgentAdapter,
    AgentCapabilities,
    AgentEvents,
    AgentSessionSummary,
} from './agent.types'

/**
 * Drives any agent that speaks ACP over stdio. One child process per adapter;
 * sessions are multiplexed over the single JSON-RPC connection.
 */
export class AcpAgent implements AgentAdapter {
    readonly id: string
    readonly name: string
    capabilities: AgentCapabilities = {
        loadSession: false,
        resumeSession: false,
        listSessions: false,
    }

    private readonly logger: Logger
    private readonly spec: AcpAgentSpec
    private child?: ChildProcess
    private conn?: ClientConnection

    constructor(spec: AcpAgentSpec) {
        this.spec = spec
        this.id = spec.id
        this.name = spec.name
        this.logger = new Logger(`AcpAgent:${spec.id}`)
    }

    async start(events: AgentEvents): Promise<void> {
        // Claude Code refuses to start when it thinks it is nested inside another
        // Claude Code session. Johnny is a separate host process, so drop the
        // markers in case the user launched it from a Claude Code terminal.
        const { CLAUDECODE: _cc, CLAUDE_CODE_ENTRYPOINT: _entry, ...env } = process.env
        const child = spawn(this.spec.command, this.spec.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...env, ...this.spec.env },
        })
        this.child = child

        // Adapters write diagnostics to stderr; surface them only when debugging.
        child.stderr?.on('data', (chunk: Buffer) => {
            this.logger.debug(chunk.toString().trimEnd())
        })

        if (!child.stdin || !child.stdout) {
            throw new Error(`${this.id}: failed to open stdio pipes`)
        }
        const stream = ndJsonStream(
            Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
            Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        )

        const conn = client({ name: 'johnny' })
            .onRequest(methods.client.session.requestPermission, async (ctx) => {
                const { sessionId, toolCall, options } = ctx.params
                const optionId = await events.permission(sessionId, toolCall, options)
                return {
                    outcome:
                        optionId === null
                            ? { outcome: 'cancelled' }
                            : { outcome: 'selected', optionId },
                }
            })
            .onNotification(methods.client.session.update, (ctx) => {
                events.update(ctx.params.sessionId, ctx.params.update)
            })
            .connect(stream)
        this.conn = conn

        conn.closed.then(() => events.closed()).catch((err) => events.closed(err))
        child.on('exit', (code, signal) => {
            conn.close(new Error(`${this.id} exited (code=${code}, signal=${signal})`))
        })

        const init = await conn.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        })
        // `resume` is newer than the SDK's SessionCapabilities type, so read the
        // block loosely.
        const sessionCaps = (init.agentCapabilities?.sessionCapabilities ?? {}) as Record<
            string,
            unknown
        >
        this.capabilities = {
            loadSession: init.agentCapabilities?.loadSession === true,
            resumeSession: sessionCaps.resume != null,
            listSessions: sessionCaps.list != null,
        }
        this.logger.log(
            `connected, protocol v${init.protocolVersion}, capabilities ${JSON.stringify(this.capabilities)}`,
        )
    }

    private get agent(): ClientContext {
        if (!this.conn) throw new Error(`${this.id} not started`)
        return this.conn.agent
    }

    private require(capability: keyof AgentCapabilities): void {
        if (!this.capabilities[capability]) {
            throw new Error(`${this.name} does not support ${capability}`)
        }
    }

    async newSession(cwd: string): Promise<string> {
        const res = await this.agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
        return res.sessionId
    }

    async loadSession(sessionId: string, cwd: string): Promise<void> {
        this.require('loadSession')
        await this.agent.request(methods.agent.session.load, { sessionId, cwd, mcpServers: [] })
    }

    async resumeSession(sessionId: string, cwd: string): Promise<void> {
        this.require('resumeSession')
        await this.agent.request(methods.agent.session.resume, { sessionId, cwd })
    }

    async listSessions(cwd: string): Promise<AgentSessionSummary[]> {
        this.require('listSessions')
        const res = await this.agent.request(methods.agent.session.list, { cwd })
        return res.sessions.map((s) => ({
            id: s.sessionId,
            cwd: s.cwd,
            title: s.title ?? null,
            updatedAt: s.updatedAt ?? null,
        }))
    }

    async prompt(sessionId: string, text: string): Promise<StopReason> {
        const res = await this.agent.request(methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: 'text', text }],
        })
        return res.stopReason
    }

    async cancel(sessionId: string): Promise<void> {
        await this.agent.notify(methods.agent.session.cancel, { sessionId })
    }

    stop(): void {
        this.conn?.close()
        this.child?.kill()
    }
}
