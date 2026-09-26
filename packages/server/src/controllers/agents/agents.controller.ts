import { Controller, Get } from '@nestjs/common'
import type { AgentInfo } from '@johnny/shared'
import { AgentRegistryService } from '../../features/agents/agent-registry.service'

@Controller('api/agents')
export class AgentsController {
    private readonly agents: AgentRegistryService

    constructor(agents: AgentRegistryService) {
        this.agents = agents
    }

    @Get()
    list(): AgentInfo[] {
        return this.agents.list()
    }
}
