import type { StopReason } from '@agentclientprotocol/sdk'
import type { Project, ServerMessage } from '@johnny/shared'
import type { AgentRegistryService } from '../agents/agent-registry.service'
import type { AgentAdapter, AgentEvents } from '../agents/agent.types'
import { SessionManagerService } from './session-manager.service'

const project: Project = { id: 'p1', name: 'proj', path: '/tmp/proj', createdAt: '2026-01-01' }

/** An adapter whose prompt behaviour each test scripts via `onPrompt`. */
class FakeAdapter implements AgentAdapter {
    readonly id = 'fake'
    readonly name = 'Fake'
    events!: AgentEvents
    onPrompt: (sessionId: string, text: string) => Promise<StopReason> = async () => 'end_turn'
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

describe('SessionManagerService', () => {
    let adapter: FakeAdapter
    let service: SessionManagerService

    beforeEach(() => {
        adapter = new FakeAdapter()
        const registry = {
            get: vi.fn(async (_agentId: string, events: AgentEvents) => {
                adapter.events = events
                return adapter
            }),
        }
        service = new SessionManagerService(registry as unknown as AgentRegistryService)
    })

    async function createAndSubscribe() {
        const info = await service.create('fake', project)
        const received: ServerMessage[] = []
        service.subscribe(info.id, (m) => received.push(m))
        return { info, received }
    }

    it('creates a session in the project directory and announces it', async () => {
        const announced: ServerMessage[] = []
        service.subscribeAll((m) => announced.push(m))

        const info = await service.create('fake', project)

        expect(info).toMatchObject({
            id: 's1',
            agentId: 'fake',
            projectId: 'p1',
            cwd: '/tmp/proj',
            busy: false,
        })
        expect(service.list()).toEqual([info])
        expect(announced).toEqual([{ type: 'session', session: info }])
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

        const items = messagesOfType(received, 'item').map((m) => m.item)
        expect(items.map((i) => i.kind)).toEqual(['user', 'update', 'turn_end'])
        expect(items[0]).toMatchObject({ kind: 'user', text: 'hello' })
        expect(items[2]).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' })

        const busyStates = messagesOfType(received, 'session').map((m) => m.session.busy)
        expect(busyStates).toEqual([true, false])
        expect(service.get(info.id)?.busy).toBe(false)
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

        const items = messagesOfType(received, 'item').map((m) => m.item)
        expect(items.at(-1)).toMatchObject({ kind: 'error', message: 'agent blew up' })
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
        const errors = messagesOfType(received, 'item').filter((m) => m.item.kind === 'error')
        expect(errors[0]?.item).toMatchObject({ message: expect.stringContaining('disconnected') })
        expect(service.get(info.id)?.busy).toBe(false)
    })
})
