import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StopReason } from '@agentclientprotocol/sdk'
import type { INestApplication } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { Test } from '@nestjs/testing'
import type { ClientMessage, ServerMessage, SessionInfo } from '@johnny/shared'
import request from 'supertest'
import { WebSocket } from 'ws'
import { AppModule } from '../../app/app.module'
import { AgentRegistryService } from '../../features/agents/agent-registry.service'
import type {
    AgentAdapter,
    AgentCapabilities,
    AgentEvents,
    AgentSessionSummary,
} from '../../features/agents/agent.types'
import { TokenService } from '../../infrastructure/token/token.service'

/**
 * Boots the real application with only the agent registry swapped for a
 * scripted adapter, then drives it over HTTP and a websocket the way the
 * browser does.
 */
class FakeAdapter implements AgentAdapter {
    readonly id = 'fake'
    readonly name = 'Fake'
    capabilities: AgentCapabilities = { loadSession: true, resumeSession: true, listSessions: true }
    events!: AgentEvents
    onPrompt: (sessionId: string, text: string) => Promise<StopReason> = async () => 'end_turn'
    known: AgentSessionSummary[] = []
    private counter = 0

    async start(events: AgentEvents) {
        this.events = events
    }
    async newSession() {
        return `s${++this.counter}`
    }
    prompt(sessionId: string, text: string) {
        return this.onPrompt(sessionId, text)
    }
    async loadSession() {}
    async resumeSession() {}
    async listSessions() {
        return this.known
    }
    async cancel() {}
    stop() {}
}

/** Collects server messages and lets a test await the next one of a type. */
class WsClient {
    readonly messages: ServerMessage[] = []
    private waiters: Array<(m: ServerMessage) => void> = []

    constructor(private readonly ws: WebSocket) {
        ws.on('message', (raw) => {
            const msg = JSON.parse(String(raw)) as ServerMessage
            this.messages.push(msg)
            for (const w of this.waiters.splice(0)) w(msg)
        })
    }

    static async connect(url: string, cookie?: string) {
        const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} })
        await new Promise<void>((resolve, reject) => {
            ws.once('open', () => resolve())
            ws.once('error', reject)
        })
        return new WsClient(ws)
    }

    send(msg: ClientMessage) {
        this.ws.send(JSON.stringify(msg))
    }

    next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
        return new Promise((resolve) => {
            const check = (m: ServerMessage) => {
                if (m.type === type) resolve(m as Extract<ServerMessage, { type: T }>)
                else this.waiters.push(check)
            }
            this.waiters.push(check)
        })
    }

    closed(): Promise<{ code: number; reason: string }> {
        return new Promise((resolve) =>
            this.ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })),
        )
    }

    close() {
        this.ws.close()
    }
}

describe('SessionsGateway (integration)', () => {
    let app: INestApplication
    let adapter: FakeAdapter
    let baseUrl: string
    let wsUrl: string
    let cookie: string
    let projectDir: string

    beforeAll(async () => {
        adapter = new FakeAdapter()
        const registry = {
            list: () => [{ id: 'fake', name: 'Fake', available: true }],
            get: async (_id: string, events: AgentEvents) => {
                adapter.events = events
                return adapter
            },
            onApplicationShutdown: () => {},
        }
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(AgentRegistryService)
            .useValue(registry)
            .compile()

        app = moduleRef.createNestApplication()
        app.useWebSocketAdapter(new WsAdapter(app))
        await app.listen(0)

        const { port } = app.getHttpServer().address() as { port: number }
        baseUrl = `http://127.0.0.1:${port}`
        wsUrl = `ws://127.0.0.1:${port}/ws`
        cookie = `johnny_token=${app.get(TokenService).token}`
        projectDir = mkdtempSync(join(tmpdir(), 'johnny-gateway-'))
    })

    afterAll(async () => {
        await app.close()
        rmSync(projectDir, { recursive: true, force: true })
    })

    async function createSession(): Promise<SessionInfo> {
        const project = await request(baseUrl)
            .post('/api/projects')
            .set('cookie', cookie)
            .send({ path: projectDir })
            .expect(201)
        const session = await request(baseUrl)
            .post('/api/sessions')
            .set('cookie', cookie)
            .send({ agentId: 'fake', projectId: project.body.id })
            .expect(201)
        return session.body as SessionInfo
    }

    it('serves the ping unauthenticated and everything else only with the cookie', async () => {
        await request(baseUrl).get('/api/ping').expect(200, { ok: true })
        await request(baseUrl).get('/api/agents').expect(401)
        await request(baseUrl).get('/api/agents').set('cookie', cookie).expect(200)
    })

    it('rejects malformed bodies with a 400 from the zod pipe', async () => {
        const res = await request(baseUrl)
            .post('/api/sessions')
            .set('cookie', cookie)
            .send({ agentId: 'fake' })
            .expect(400)
        expect(res.body.errors[0].path).toEqual(['projectId'])
    })

    it("imports the agent's sessions for a project and lists them afterwards", async () => {
        const project = await request(baseUrl)
            .post('/api/projects')
            .set('cookie', cookie)
            .send({ path: projectDir })
            .expect(201)
        adapter.known = [
            { id: 'cli-1', cwd: projectDir, title: 'From the terminal', updatedAt: null },
        ]

        const imported = await request(baseUrl)
            .post('/api/sessions/import')
            .set('cookie', cookie)
            .send({ agentId: 'fake', projectId: project.body.id })
            .expect(201)
        expect(imported.body).toEqual([
            expect.objectContaining({ id: 'cli-1', title: 'From the terminal', origin: 'agent' }),
        ])

        const listed = await request(baseUrl).get('/api/sessions').set('cookie', cookie).expect(200)
        expect(listed.body).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'cli-1' })]),
        )

        await request(baseUrl).delete('/api/sessions/cli-1').set('cookie', cookie).expect(204)
        await request(baseUrl).delete('/api/sessions/cli-1').set('cookie', cookie).expect(404)
    })

    it('closes websocket connections that do not carry the token cookie', async () => {
        const client = await WsClient.connect(wsUrl)
        await expect(client.closed()).resolves.toMatchObject({ code: 1008 })
    })

    it('streams a prompt turn, including a permission round trip, to a subscriber', async () => {
        const session = await createSession()
        adapter.onPrompt = async (sessionId) => {
            adapter.events.update(sessionId, {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'working' },
            })
            const choice = await adapter.events.permission(
                sessionId,
                { toolCallId: 'c1', title: 'Write file' },
                [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
            )
            adapter.events.update(sessionId, {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: ` chose ${choice}` },
            })
            return 'end_turn'
        }

        const client = await WsClient.connect(wsUrl, cookie)
        client.send({ event: 'subscribe', data: { sessionId: session.id } })
        const transcript = await client.next('transcript')
        expect(transcript).toMatchObject({ sessionId: session.id, items: [], pending: null })

        client.send({ event: 'prompt', data: { sessionId: session.id, text: 'go' } })
        const permission = await client.next('permission_request')
        expect(permission.request.toolCall.toolCallId).toBe('c1')

        client.send({
            event: 'permission',
            data: { requestId: permission.request.requestId, optionId: 'allow' },
        })
        await client.next('permission_resolved')

        await vi.waitFor(() => {
            const kinds = client.messages
                .filter((m) => m.type === 'item')
                .map((m) => (m.type === 'item' ? m.item.kind : ''))
            expect(kinds).toEqual(['user', 'update', 'update', 'turn_end'])
        })
        const text = client.messages
            .flatMap((m) => (m.type === 'item' && m.item.kind === 'update' ? [m.item.update] : []))
            .map((u) =>
                u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text'
                    ? u.content.text
                    : '',
            )
            .join('')
        expect(text).toBe('working chose allow')

        const sessions = client.messages.filter((m) => m.type === 'session')
        expect(sessions.at(-1)).toMatchObject({ session: { id: session.id, busy: false } })
        client.close()
    })
})
