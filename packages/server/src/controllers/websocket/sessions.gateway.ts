import type { IncomingMessage } from 'node:http'
import { Inject, Logger } from '@nestjs/common'
import {
    ConnectedSocket,
    MessageBody,
    type OnGatewayConnection,
    type OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
} from '@nestjs/websockets'
import type { ClientMessage, ServerMessage } from '@johnny/shared'
import type { WebSocket } from 'ws'
import {
    errorMessage,
    SessionManagerService,
} from '../../features/sessions/session-manager.service'
import { APP_OPTIONS, type AppOptions } from '../../infrastructure/config/options'
import { TokenService } from '../../infrastructure/token/token.service'

const CLOSE_POLICY_VIOLATION = 1008

type Payload<E extends ClientMessage['event']> = Extract<ClientMessage, { event: E }>['data']

/**
 * Streams session events to the browser and accepts prompts, cancellations and
 * permission decisions. Express middleware does not run on the upgrade request,
 * so the token cookie is checked again here.
 */
@WebSocketGateway({ path: '/ws' })
export class SessionsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(SessionsGateway.name)
    private readonly unsubscribers = new Map<WebSocket, Array<() => void>>()
    private readonly sessions: SessionManagerService
    private readonly tokens: TokenService
    private readonly options: AppOptions

    constructor(
        sessions: SessionManagerService,
        tokens: TokenService,
        @Inject(APP_OPTIONS) options: AppOptions,
    ) {
        this.sessions = sessions
        this.tokens = tokens
        this.options = options
    }

    handleConnection(client: WebSocket, req: IncomingMessage) {
        if (this.options.auth !== 'proxy' && !this.tokens.verifyCookieHeader(req.headers.cookie)) {
            client.close(CLOSE_POLICY_VIOLATION, 'Unauthorised')
            return
        }
        this.unsubscribers.set(client, [
            this.sessions.subscribeAll((msg) => this.send(client, msg)),
        ])
    }

    handleDisconnect(client: WebSocket) {
        for (const off of this.unsubscribers.get(client) ?? []) off()
        this.unsubscribers.delete(client)
    }

    @SubscribeMessage('subscribe')
    subscribe(@ConnectedSocket() client: WebSocket, @MessageBody() data: Payload<'subscribe'>) {
        const off = this.sessions.subscribe(data.sessionId, (msg) => this.send(client, msg))
        this.unsubscribers.get(client)?.push(off)
    }

    @SubscribeMessage('prompt')
    prompt(@ConnectedSocket() client: WebSocket, @MessageBody() data: Payload<'prompt'>) {
        this.sessions.prompt(data.sessionId, data.text).catch((err) => {
            this.send(client, {
                type: 'error',
                sessionId: data.sessionId,
                message: errorMessage(err),
            })
        })
    }

    @SubscribeMessage('cancel')
    async cancel(@ConnectedSocket() client: WebSocket, @MessageBody() data: Payload<'cancel'>) {
        try {
            await this.sessions.cancel(data.sessionId)
        } catch (err) {
            this.send(client, {
                type: 'error',
                sessionId: data.sessionId,
                message: errorMessage(err),
            })
        }
    }

    @SubscribeMessage('permission')
    permission(@ConnectedSocket() client: WebSocket, @MessageBody() data: Payload<'permission'>) {
        if (!this.sessions.resolvePermission(data.requestId, data.optionId)) {
            this.send(client, { type: 'error', message: 'Permission request no longer pending' })
        }
    }

    private send(client: WebSocket, msg: ServerMessage) {
        if (client.readyState !== client.OPEN) return
        client.send(JSON.stringify(msg), (err) => {
            if (err) this.logger.warn(`send failed: ${err.message}`)
        })
    }
}
