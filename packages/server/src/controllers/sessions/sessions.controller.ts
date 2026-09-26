import { existsSync } from 'node:fs'
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    InternalServerErrorException,
    NotFoundException,
    Param,
    Post,
} from '@nestjs/common'
import type { Project, SessionInfo } from '@johnny/shared'
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
        const project = this.project(body.projectId)
        try {
            return await this.sessions.create(body.agentId, project)
        } catch (err) {
            throw new InternalServerErrorException(errorMessage(err))
        }
    }

    /** Adopt the agent's existing sessions for a project; returns the newly added ones. */
    @Post('import')
    async import(@Body() body: CreateSessionDto): Promise<SessionInfo[]> {
        const project = this.project(body.projectId)
        try {
            return await this.sessions.importFromAgent(body.agentId, project)
        } catch (err) {
            throw new InternalServerErrorException(errorMessage(err))
        }
    }

    @Delete(':id')
    @HttpCode(204)
    remove(@Param('id') id: string): void {
        if (!this.sessions.remove(id)) throw new NotFoundException('Not found')
    }

    private project(projectId: string): Project {
        const project = this.projects.get(projectId)
        if (!project) throw new NotFoundException('Unknown project')
        if (!existsSync(project.path)) {
            throw new BadRequestException(`Directory not found: ${project.path}`)
        }
        return project
    }
}
