// A tiny scripted ACP agent used to exercise AcpAgent over a real stdio
// JSON-RPC connection. Behaviour is keyed off the prompt text:
//
//   "ask"    → requests permission, then reports which option was chosen
//   "hang"   → never finishes until cancelled
//   "exit"   → exits the process mid-turn
//   anything else → streams "echo: <text>" as a message chunk and a tool call
//
// Session history is written to FAKE_ACP_STATE_DIR (one JSON file per session)
// so a later process can list and load sessions the way a real agent does.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const stateDir = process.env.FAKE_ACP_STATE_DIR ?? mkdtempSync(join(tmpdir(), 'fake-acp-'))
mkdirSync(stateDir, { recursive: true })

const pending = new Map()
let counter = 0

function readSession(id) {
    return JSON.parse(readFileSync(join(stateDir, `${id}.json`), 'utf8'))
}
function writeSession(session) {
    writeFileSync(join(stateDir, `${session.sessionId}.json`), JSON.stringify(session))
}
function allSessions() {
    return readdirSync(stateDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readSession(f.slice(0, -5)))
}
function record(sessionId, update) {
    const session = readSession(sessionId)
    session.history.push(update)
    session.updatedAt = new Date().toISOString()
    if (!session.title && update.sessionUpdate === 'user_message_chunk') {
        session.title = update.content.text
    }
    writeSession(session)
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))

agent({ name: 'fake-agent' })
    .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { list: {}, resume: {} },
        },
    }))
    .onRequest(methods.agent.session.new, (ctx) => {
        const sessionId = `fake-session-${process.pid}-${++counter}`
        writeSession({
            sessionId,
            cwd: ctx.params.cwd,
            title: null,
            updatedAt: new Date().toISOString(),
            history: [],
        })
        return { sessionId }
    })
    .onRequest(methods.agent.session.list, (ctx) => ({
        sessions: allSessions()
            .filter((s) => !ctx.params.cwd || s.cwd === ctx.params.cwd)
            .map(({ sessionId, cwd, title, updatedAt }) => ({ sessionId, cwd, title, updatedAt })),
    }))
    .onRequest(methods.agent.session.load, async (ctx) => {
        const { sessionId } = ctx.params
        for (const update of readSession(sessionId).history) {
            await ctx.client.notify(methods.client.session.update, { sessionId, update })
        }
        return {}
    })
    .onRequest(methods.agent.session.resume, (ctx) => {
        readSession(ctx.params.sessionId)
        return {}
    })
    .onRequest(methods.agent.session.prompt, async (ctx) => {
        const { sessionId, prompt } = ctx.params
        const text = prompt.map((p) => (p.type === 'text' ? p.text : '')).join('')
        const send = async (update) => {
            record(sessionId, update)
            await ctx.client.notify(methods.client.session.update, { sessionId, update })
        }
        const say = (t) =>
            send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } })

        record(sessionId, {
            sessionUpdate: 'user_message_chunk',
            messageId: `m${Date.now()}`,
            content: { type: 'text', text },
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
        await send({
            sessionUpdate: 'tool_call',
            toolCallId: 'call-1',
            title: 'Read File',
            kind: 'read',
            status: 'completed',
        })
        return { stopReason: 'end_turn' }
    })
    .onNotification(methods.agent.session.cancel, (ctx) => {
        pending.get(ctx.params.sessionId)?.abort()
    })
    .connect(stream)
