import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    let stateDir: string
    let agent: AcpAgent
    let updates: SessionUpdate[]
    let events: AgentEvents
    let closed: ReturnType<typeof vi.fn<(error?: unknown) => void>>

    function newAgent() {
        return new AcpAgent({
            id: 'fake',
            name: 'Fake',
            command: process.execPath,
            args: [FIXTURE],
            env: { FAKE_ACP_STATE_DIR: stateDir },
        })
    }

    beforeEach(async () => {
        stateDir = mkdtempSync(join(tmpdir(), 'fake-acp-state-'))
        updates = []
        closed = vi.fn<(error?: unknown) => void>()
        events = {
            update: (_sessionId, update) => {
                updates.push(update)
            },
            permission: vi.fn(async () => 'yes'),
            closed,
        }
        agent = newAgent()
        await agent.start(events)
    })

    afterEach(() => {
        agent.stop()
        rmSync(stateDir, { recursive: true, force: true })
    })

    it('reads capabilities from the handshake', () => {
        expect(agent.capabilities).toEqual({
            loadSession: true,
            resumeSession: true,
            listSessions: true,
        })
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

    it('lists earlier sessions and replays one into a fresh process', async () => {
        const sessionId = await agent.newSession('/tmp/proj')
        await agent.prompt(sessionId, 'hello')
        agent.stop()

        // A brand-new adapter process, as after Johnny restarts.
        agent = newAgent()
        updates = []
        await agent.start(events)

        const listed = await agent.listSessions('/tmp/proj')
        expect(listed).toEqual([
            expect.objectContaining({ id: sessionId, cwd: '/tmp/proj', title: 'hello' }),
        ])
        expect(await agent.listSessions('/elsewhere')).toEqual([])

        await agent.loadSession(sessionId, '/tmp/proj')
        expect(updates.map((u) => u.sessionUpdate)).toEqual([
            'user_message_chunk',
            'agent_message_chunk',
            'tool_call',
        ])
        expect(textOf(updates)).toBe('echo: hello')

        await expect(agent.resumeSession(sessionId, '/tmp/proj')).resolves.toBeUndefined()
        await expect(agent.resumeSession('missing', '/tmp/proj')).rejects.toThrow()
    })
})
