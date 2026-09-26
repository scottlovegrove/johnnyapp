import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Post,
} from '@nestjs/common'
import type { Project } from '@johnny/shared'
import { ProjectStoreService } from '../../features/projects/project-store.service'
import { CreateProjectDto } from './projects.dto'

@Controller('api/projects')
export class ProjectsController {
    private readonly projects: ProjectStoreService

    constructor(projects: ProjectStoreService) {
        this.projects = projects
    }

    @Get()
    list(): Project[] {
        return this.projects.list()
    }

    @Post()
    create(@Body() body: CreateProjectDto): Project {
        try {
            return this.projects.add(body.path, body.name)
        } catch (err) {
            throw new BadRequestException(err instanceof Error ? err.message : String(err))
        }
    }

    @Delete(':id')
    @HttpCode(204)
    remove(@Param('id') id: string): void {
        if (!this.projects.remove(id)) throw new NotFoundException('Not found')
    }
}
