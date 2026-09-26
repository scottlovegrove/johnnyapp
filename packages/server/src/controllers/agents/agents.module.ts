import { Module } from '@nestjs/common'
import { AgentsModule } from '../../features/agents/agents.module'
import { AgentsController } from './agents.controller'

@Module({
    imports: [AgentsModule],
    controllers: [AgentsController],
})
export class AgentsControllerModule {}
