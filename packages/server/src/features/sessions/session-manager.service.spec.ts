import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionUpdate, StopReason } from '@agentclientprotocol/sdk'
import type { Project, ServerMessage, SessionInfo } from '@johnny/shared'
import { CONFIG_DIR } from '../../infrastructure/token/token.service'
import type { AgentRegistryService } from '../agents/agent-registry.service'
import type {
    AgentAdapter,
    AgentCapabilities,
    AgentEvents,
    AgentSessionSummary,
} from '../agents/agent.types'
import { SessionManagerService } from './session-manager.service'
import { SessionStoreService } from './session-store.service'

const project: Project = { id: 'p1', name: 'proj', path: '/tmp/proj', createdAt: '2026-01-01' }

/** An adapter whose behaviour each test scripts via the `on*` hooks. */
class FakeAdapter implements AgentAdapter {
    readonly id = 'fake'
    readonly name = 'Fake'
    capabilities: AgentCapabilities = { loadSession: true, resumeSession: true, listSessions: true }
    events!: AgentEvents
    onPrompt: (sessionId: string, text: string) => Promise<StopReason> = async () => 'end_turn'
    /** History replayed by `loadSession`, keyed by session id. */
    history = new Map<string, SessionUpdate[]>()
    known: AgentSessionSummary[] = []
    loadSession = vi.fn(async (sessionId: string) => {
        for (const update of this.history.get(sessionId) ?? []) {
            this.events.update(sessionId, update)
        }
    })
    resumeSession = vi.fn(async () => {})
    listSessions = vi.fn(async () => this.known)
    cancel = vi.fn(async () => {})
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
    stop() {}
}

function messagesOfType<T extends ServerMessage['type']>(msgs: ServerMessage[], type: T) {
    return msgs.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
}

function itemsOf(msgs: ServerMessage[]) {
    return messagesOfType(msgs, 'item').map((m) => m.item)
}

/** The transcript a fresh subscriber would be handed right now. */
function currentTranscript(service: SessionManagerService, sessionId: string) {
    const received: ServerMessage[] = []
    service.subscribe(sessionId, (m) => received.push(m))()
    return messagesOfType(received, 'transcript')[0]?.items ?? []
}

describe('SessionManagerService', () => {
    let adapter: FakeAdapter
    let service: SessionManagerService

    function build() {
        const registry = {
            get: vi.fn(async (_agentId: string, events: AgentEvents) => {
                adapter.events = events
                return adapter
            }),
        }
        return new SessionManagerService(
            registry as unknown as AgentRegistryService,
            new SessionStoreService(),
        )
    }

    beforeEach(() => {
        rmSync(join(CONFIG_DIR, 'sessions.json'), { force: true })
        adapter = new FakeAdapter()
        service = build()
    })

    async function createAndSubscribe() {
        const info = await service.create('fake', project)
        const received: ServerMessage[] = []
        service.subscribe(info.id, (m) => received.push(m))
        return { info, received }
    }

    it('creates a session in the project directory, announces and persists it', async () => {
        const announced: ServerMessage[] = []
        service.subscribeAll((m) => announced.push(m))

        const info = await service.create('fake', project)

        expect(info).toMatchObject({
            id: 's1',
            agentId: 'fake',
            projectId: 'p1',
            cwd: '/tmp/proj',
            origin: 'johnny',
            busy: false,
            resuming: false,
        })
        expect(service.list()).toEqual([info])
        expect(announced).toEqual([{ type: 'session', session: info }])
        expect(new SessionStoreService().get('s1')).toMatchObject({ id: 's1', title: info.title })
    })

    it('records a prompt turn in the transcript and toggles busy around it', async () => {
        const { info, received } = await createAndSubscribe()
        adapter.onPrompt = async (sessionId) => {
            adapter.events.update(sessionId, {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'hi' },
            })
            return 'end_turn'
        }

        await service.prompt(info.id, 'hello')

        const items = itemsOf(received)
        expect(items.map((i) => i.kind)).toEqual(['user', 'update', 'turn_end'])
        expect(items[0]).toMatchObject({ kind: 'user', text: 'hello' })
        expect(items[2]).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' })

        const busyStates = messagesOfType(received, 'session').map((m) => m.session.busy)
        expect(busyStates).toEqual([true, false])
        expect(service.get(info.id)?.busy).toBe(false)
        expect(adapter.loadSession).not.toHaveBeenCalled()
    })

    it('adopts the title the agent gives the session after a turn', async () => {
        const { info } = await createAndSubscribe()
        const announced: ServerMessage[] = []
        service.subscribeAll((m) => announced.push(m))
        adapter.known = [
            { id: info.id, cwd: project.path, title: 'Fix the tests', updatedAt: null },
        ]

        await service.prompt(info.id, 'fix the tests please')

        expect(service.get(info.id)?.title).toBe('Fix the tests')
        expect(announced.at(-1)).toMatchObject({ session: { title: 'Fix the tests' } })
        expect(new SessionStoreService().get(info.id)?.title).toBe('Fix the tests')
    })

    it('rejects a second prompt while one is in flight', async () => {
        const { info } = await createAndSubscribe()
        let finish!: () => void
        adapter.onPrompt = () => new Promise((resolve) => (finish = () => resolve('end_turn')))

        const first = service.prompt(info.id, 'one')
        await expect(service.prompt(info.id, 'two')).rejects.toThrow('busy')

        finish()
        await first
    })

    it('surfaces permission requests and resolves them with the chosen option', async () => {
        const { info, received } = await createAndSubscribe()
        let chosen: string | null | undefined
        adapter.onPrompt = async (sessionId) => {
            chosen = await adapter.events.permission(
                sessionId,
                { toolCallId: 'c1', title: 'Write file' },
                [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
            )
            return 'end_turn'
        }

        const turn = service.prompt(info.id, 'do it')
        await vi.waitFor(() =>
            expect(messagesOfType(received, 'permission_request')).toHaveLength(1),
        )
        const requestId = messagesOfType(received, 'permission_request')[0]?.request.requestId
        if (!requestId) throw new Error('expected a permission request')

        // A late subscriber sees the pending request in the replayed transcript.
        const replay: ServerMessage[] = []
        service.subscribe(info.id, (m) => replay.push(m))
        expect(replay[0]).toMatchObject({ type: 'transcript', pending: { requestId } })

        expect(service.resolvePermission(requestId, 'allow')).toBe(true)
        await turn

        expect(chosen).toBe('allow')
        expect(messagesOfType(received, 'permission_resolved')).toHaveLength(1)
        expect(service.resolvePermission(requestId, 'allow')).toBe(false)
    })

    it('cancel declines any pending permission and forwards to the adapter', async () => {
        const { info, received } = await createAndSubscribe()
        let chosen: string | null | undefined
        adapter.onPrompt = async (sessionId) => {
            chosen = await adapter.events.permission(sessionId, { toolCallId: 'c1' }, [])
            return 'cancelled'
        }

        const turn = service.prompt(info.id, 'do it')
        await vi.waitFor(() =>
            expect(messagesOfType(received, 'permission_request')).toHaveLength(1),
        )
        await service.cancel(info.id)
        await turn

        expect(chosen).toBeNull()
        expect(adapter.cancel).toHaveBeenCalledWith(info.id)
    })

    it('turns adapter failures into an error item and clears busy', async () => {
        const { info, received } = await createAndSubscribe()
        adapter.onPrompt = async () => {
            throw Object.assign(new Error('Internal error'), { data: { details: 'agent blew up' } })
        }

        await service.prompt(info.id, 'hello')

        expect(itemsOf(received).at(-1)).toMatchObject({ kind: 'error', message: 'agent blew up' })
        expect(service.get(info.id)?.busy).toBe(false)
    })

    it('fails busy sessions and declines pending permissions when the agent disconnects', async () => {
        const { info, received } = await createAndSubscribe()
        let chosen: string | null | undefined
        adapter.onPrompt = async (sessionId) => {
            chosen = await adapter.events.permission(sessionId, { toolCallId: 'c1' }, [])
            throw new Error('connection closed')
        }

        const turn = service.prompt(info.id, 'do it')
        await vi.waitFor(() =>
            expect(messagesOfType(received, 'permission_request')).toHaveLength(1),
        )
        adapter.events.closed(new Error('exited'))
        await turn

        expect(chosen).toBeNull()
        const errors = itemsOf(received).filter((i) => i.kind === 'error')
        expect(errors[0]).toMatchObject({ message: expect.stringContaining('disconnected') })
        expect(service.get(info.id)?.busy).toBe(false)
    })

    describe('after a restart', () => {
        let info: SessionInfo

        beforeEach(async () => {
            info = await service.create('fake', project)
            adapter.history.set(info.id, [
                {
                    sessionUpdate: 'user_message_chunk',
                    messageId: 'm1',
                    content: { type: 'text', text: 'what is ' },
                },
                {
                    sessionUpdate: 'user_message_chunk',
                    messageId: 'm1',
                    content: { type: 'text', text: '2+2?' },
                },
                { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '4' } },
            ])
            // A new manager over the same store, as after a process restart.
            service = build()
        })

        it('lists the stored session and replays its history on first subscribe', async () => {
            expect(service.list()).toEqual([expect.objectContaining({ id: info.id, busy: false })])

            const received: ServerMessage[] = []
            service.subscribe(info.id, (m) => received.push(m))
            expect(received[0]).toMatchObject({ type: 'transcript', items: [] })

            await vi.waitFor(() => expect(messagesOfType(received, 'transcript')).toHaveLength(2))
            const replayed = messagesOfType(received, 'transcript')[1]?.items ?? []
            expect(replayed).toEqual([
                expect.objectContaining({ kind: 'user', text: 'what is 2+2?' }),
                expect.objectContaining({
                    kind: 'update',
                    update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
                }),
            ])
            // Replay arrives as one transcript, not item by item; the session
            // is flagged as resuming while it happens and never busy.
            expect(itemsOf(received)).toEqual([])
            expect(
                messagesOfType(received, 'session').map((m) => [
                    m.session.resuming,
                    m.session.busy,
                ]),
            ).toEqual([
                [true, false],
                [false, false],
            ])
            expect(adapter.loadSession).toHaveBeenCalledWith(info.id, project.path)
        })

        it('re-attaches before a prompt and does not load twice', async () => {
            await service.prompt(info.id, 'and 3+3?')
            await service.prompt(info.id, 'and 4+4?')

            expect(adapter.loadSession).toHaveBeenCalledTimes(1)
            expect(adapter.resumeSession).not.toHaveBeenCalled()
            expect(currentTranscript(service, info.id).map((i) => i.kind)).toEqual([
                'user',
                'update',
                'user',
                'turn_end',
                'user',
                'turn_end',
            ])
        })

        it("imports the agent's own sessions for a project, skipping known ones", async () => {
            adapter.known = [
                { id: info.id, cwd: project.path, title: 'already here', updatedAt: null },
                {
                    id: 'from-cli',
                    cwd: project.path,
                    title: 'Started in the terminal',
                    updatedAt: '2026-05-01T10:00:00.000Z',
                },
            ]
            const announced: ServerMessage[] = []
            service.subscribeAll((m) => announced.push(m))

            const added = await service.importFromAgent('fake', project)

            expect(added).toEqual([
                expect.objectContaining({
                    id: 'from-cli',
                    title: 'Started in the terminal',
                    origin: 'agent',
                    lastActiveAt: '2026-05-01T10:00:00.000Z',
                }),
            ])
            expect(announced).toHaveLength(1)
            expect(new SessionStoreService().get('from-cli')).toBeDefined()
            expect(service.get(info.id)?.title).not.toBe('already here')
        })

        it('remove forgets the session everywhere and keeps it out of imports', async () => {
            expect(service.remove(info.id)).toBe(true)
            expect(service.get(info.id)).toBeUndefined()
            expect(new SessionStoreService().get(info.id)).toBeUndefined()
            expect(service.remove(info.id)).toBe(false)

            adapter.known = [
                { id: info.id, cwd: project.path, title: 'still in agent', updatedAt: null },
            ]
            expect(await service.importFromAgent('fake', project)).toEqual([])
            expect(service.list()).toEqual([])
        })
    })
})
