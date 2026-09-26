// A tiny scripted ACP agent used to exercise AcpAgent over a real stdio
// JSON-RPC connection. Behaviour is keyed off the prompt text:
//
//   "ask"    → requests permission, then reports which option was chosen
//   "hang"   → never finishes until cancelled
//   "exit"   → exits the process mid-turn
//   anything else → streams "echo: <text>" as a message chunk and a tool call
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const pending = new Map()
let counter = 0

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))

agent({ name: 'fake-agent' })
    .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
    }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: `fake-session-${++counter}` }))
    .onRequest(methods.agent.session.prompt, async (ctx) => {
        const { sessionId, prompt } = ctx.params
        const text = prompt.map((p) => (p.type === 'text' ? p.text : '')).join('')
        const say = (t) =>
            ctx.client.notify(methods.client.session.update, {
                sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: t },
                },
            })

        if (text === 'exit') process.exit(3)

        if (text === 'hang') {
            const controller = new AbortController()
            pending.set(sessionId, controller)
            await new Promise((resolve) => controller.signal.addEventListener('abort', resolve))
            pending.delete(sessionId)
            return { stopReason: 'cancelled' }
        }

        if (text === 'ask') {
            const res = await ctx.client.request(methods.client.session.requestPermission, {
                sessionId,
                toolCall: { toolCallId: 'call-ask', title: 'Do the thing', kind: 'edit' },
                options: [
                    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
                    { optionId: 'no', name: 'No', kind: 'reject_once' },
                ],
            })
            await say(
                res.outcome.outcome === 'cancelled' ? 'cancelled' : `chose:${res.outcome.optionId}`,
            )
            return { stopReason: 'end_turn' }
        }

        await say(`echo: ${text}`)
        await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call-1',
                title: 'Read File',
                kind: 'read',
                status: 'completed',
            },
        })
        return { stopReason: 'end_turn' }
    })
    .onNotification(methods.agent.session.cancel, (ctx) => {
        pending.get(ctx.params.sessionId)?.abort()
    })
    .connect(stream)
