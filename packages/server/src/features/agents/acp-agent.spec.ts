import { join } from 'node:path'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { AcpAgent } from './acp-agent'
import type { AgentEvents } from './agent.types'

const FIXTURE = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'fake-acp-agent.mjs')

function textOf(updates: SessionUpdate[]): string {
    return updates
        .filter((u) => u.sessionUpdate === 'agent_message_chunk')
        .map((u) => (u.content.type === 'text' ? u.content.text : ''))
        .join('')
}

describe('AcpAgent', () => {
    let agent: AcpAgent
    let updates: SessionUpdate[]
    let events: AgentEvents
    let closed: ReturnType<typeof vi.fn<(error?: unknown) => void>>

    beforeEach(async () => {
        updates = []
        closed = vi.fn<(error?: unknown) => void>()
        events = {
            update: (_sessionId, update) => {
                updates.push(update)
            },
            permission: vi.fn(async () => 'yes'),
            closed,
        }
        agent = new AcpAgent({
            id: 'fake',
            name: 'Fake',
            command: process.execPath,
            args: [FIXTURE],
        })
        await agent.start(events)
    })

    afterEach(() => {
        agent.stop()
    })

    it('creates a session and streams a prompt turn to the event sink', async () => {
        const sessionId = await agent.newSession('/tmp')
        expect(sessionId).toMatch(/^fake-session-/)

        const stopReason = await agent.prompt(sessionId, 'hello')

        expect(stopReason).toBe('end_turn')
        expect(textOf(updates)).toBe('echo: hello')
        expect(updates.some((u) => u.sessionUpdate === 'tool_call')).toBe(true)
    })

    it('routes permission requests through the sink and returns the chosen option', async () => {
        const sessionId = await agent.newSession('/tmp')
        await agent.prompt(sessionId, 'ask')

        expect(events.permission).toHaveBeenCalledWith(
            sessionId,
            expect.objectContaining({ toolCallId: 'call-ask' }),
            expect.arrayContaining([expect.objectContaining({ optionId: 'yes' })]),
        )
        expect(textOf(updates)).toBe('chose:yes')
    })

    it('reports a cancelled outcome when the sink declines to choose', async () => {
        vi.mocked(events.permission).mockResolvedValueOnce(null)
        const sessionId = await agent.newSession('/tmp')
        await agent.prompt(sessionId, 'ask')
        expect(textOf(updates)).toBe('cancelled')
    })

    it('cancel ends an in-flight turn with stopReason cancelled', async () => {
        const sessionId = await agent.newSession('/tmp')
        const turn = agent.prompt(sessionId, 'hang')
        await agent.cancel(sessionId)
        await expect(turn).resolves.toBe('cancelled')
    })

    it('reports closed when the agent process exits', async () => {
        const sessionId = await agent.newSession('/tmp')
        await expect(agent.prompt(sessionId, 'exit')).rejects.toThrow()
        await vi.waitFor(() => expect(closed).toHaveBeenCalled())
    })
})
