import { Module } from '@nestjs/common'
import { SessionsModule } from '../../features/sessions/sessions.module'
import { SessionsGateway } from './sessions.gateway'

@Module({
    imports: [SessionsModule],
    providers: [SessionsGateway],
})
export class WebSocketModule {}
