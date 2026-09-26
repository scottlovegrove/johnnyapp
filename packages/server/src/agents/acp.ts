import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
    client,
    methods,
    ndJsonStream,
    PROTOCOL_VERSION,
    type ClientConnection,
    type ClientContext,
    type StopReason,
} from '@agentclientprotocol/sdk'
import type { AgentAdapter, AgentEvents } from './types.js'

export interface AcpAgentSpec {
    id: string
    name: string
    command: string
    args: string[]
    env?: Record<string, string>
}

/**
 * Drives any agent that speaks ACP over stdio. One child process per adapter;
 * sessions are multiplexed over the single JSON-RPC connection.
 */
export class AcpAgent implements AgentAdapter {
    readonly id: string
    readonly name: string

    private child?: ChildProcess
    private conn?: ClientConnection

    constructor(private readonly spec: AcpAgentSpec) {
        this.id = spec.id
        this.name = spec.name
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

        child.stderr?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[${this.id}] ${chunk}`)
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
        console.log(`[${this.id}] connected, protocol v${init.protocolVersion}`)
    }

    private get agent(): ClientContext {
        if (!this.conn) throw new Error(`${this.id} not started`)
        return this.conn.agent
    }

    async newSession(cwd: string): Promise<string> {
        const res = await this.agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
        return res.sessionId
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
