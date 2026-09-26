import { Module } from '@nestjs/common'
import { AgentsModule } from '../agents/agents.module'
import { SessionManagerService } from './session-manager.service'

@Module({
    imports: [AgentsModule],
    providers: [SessionManagerService],
    exports: [SessionManagerService],
})
export class SessionsModule {}
