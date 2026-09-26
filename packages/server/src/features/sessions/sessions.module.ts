import { Module } from '@nestjs/common'
import { AgentsModule } from '../agents/agents.module'
import { SessionManagerService } from './session-manager.service'
import { SessionStoreService } from './session-store.service'

@Module({
    imports: [AgentsModule],
    providers: [SessionManagerService, SessionStoreService],
    exports: [SessionManagerService],
})
export class SessionsModule {}
