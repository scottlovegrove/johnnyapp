import { existsSync } from 'node:fs'
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    InternalServerErrorException,
    NotFoundException,
    Post,
} from '@nestjs/common'
import type { SessionInfo } from '@johnny/shared'
import { ProjectStoreService } from '../../features/projects/project-store.service'
import {
    errorMessage,
    SessionManagerService,
} from '../../features/sessions/session-manager.service'
import { CreateSessionDto } from './sessions.dto'

@Controller('api/sessions')
export class SessionsController {
    private readonly sessions: SessionManagerService
    private readonly projects: ProjectStoreService

    constructor(sessions: SessionManagerService, projects: ProjectStoreService) {
        this.sessions = sessions
        this.projects = projects
    }

    @Get()
    list(): SessionInfo[] {
        return this.sessions.list()
    }

    @Post()
    async create(@Body() body: CreateSessionDto): Promise<SessionInfo> {
        const project = this.projects.get(body.projectId)
        if (!project) throw new NotFoundException('Unknown project')
        if (!existsSync(project.path)) {
            throw new BadRequestException(`Directory not found: ${project.path}`)
        }
        try {
            return await this.sessions.create(body.agentId, project)
        } catch (err) {
            throw new InternalServerErrorException(errorMessage(err))
        }
    }
}
