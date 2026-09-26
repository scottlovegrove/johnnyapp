import type { ServerMessage } from '@johnny/shared'

/** Minimal stand-in for the browser WebSocket that tests drive by hand. */
class FakeWebSocket {
    static instances: FakeWebSocket[] = []
    static OPEN = 1
    readonly OPEN = 1
    readyState = 0
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((evt: { data: string }) => void) | null = null
    onclose: ((evt: { code: number }) => void) | null = null

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this)
    }

    send(data: string) {
        this.sent.push(data)
    }

    open() {
        this.readyState = 1
        this.onopen?.()
    }

    receive(msg: ServerMessage) {
        this.onmessage?.({ data: JSON.stringify(msg) })
    }

    drop(code = 1006) {
        this.readyState = 3
        this.onclose?.({ code })
    }
}

async function loadModule() {
    vi.resetModules()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    return import('./ws')
}

describe('socket', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('connects to /ws on the page origin and queues sends until open', async () => {
        const { socket } = await loadModule()
        const [ws] = FakeWebSocket.instances
        expect(ws?.url).toBe(`ws://${location.host}/ws`)

        socket.send({ event: 'subscribe', data: { sessionId: 's1' } })
        expect(ws?.sent).toEqual([])

        ws?.open()
        expect(ws?.sent).toEqual([
            JSON.stringify({ event: 'subscribe', data: { sessionId: 's1' } }),
        ])
        expect(socket.status).toBe('open')
    })

    it('delivers parsed server messages to listeners until they unsubscribe', async () => {
        const { socket } = await loadModule()
        const [ws] = FakeWebSocket.instances
        ws?.open()
        const listener = vi.fn()
        const off = socket.on(listener)

        ws?.receive({ type: 'permission_resolved', requestId: 'r1' })
        expect(listener).toHaveBeenCalledWith({ type: 'permission_resolved', requestId: 'r1' })

        off()
        ws?.receive({ type: 'permission_resolved', requestId: 'r2' })
        expect(listener).toHaveBeenCalledTimes(1)
    })

    it('sends the browser to the login page when the server refuses the cookie', async () => {
        const assign = vi.fn()
        vi.stubGlobal('location', { ...location, pathname: '/sessions/abc', search: '', assign })
        const { socket } = await loadModule()
        const [ws] = FakeWebSocket.instances
        ws?.open()

        ws?.drop(1008)

        expect(assign).toHaveBeenCalledWith('/login?next=%2Fsessions%2Fabc')
        await vi.advanceTimersByTimeAsync(2000)
        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(socket.status).toBe('open')
    })

    it('reconnects with backoff after the connection drops', async () => {
        const { socket } = await loadModule()
        const [first] = FakeWebSocket.instances
        first?.open()

        first?.drop()
        expect(socket.status).toBe('closed')
        expect(FakeWebSocket.instances).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(500)
        expect(FakeWebSocket.instances).toHaveLength(2)
        FakeWebSocket.instances[1]?.open()
        expect(socket.status).toBe('open')
    })
})
