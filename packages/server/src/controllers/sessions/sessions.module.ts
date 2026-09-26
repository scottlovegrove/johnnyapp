import { Module } from '@nestjs/common'
import { ProjectsModule } from '../../features/projects/projects.module'
import { SessionsModule } from '../../features/sessions/sessions.module'
import { SessionsController } from './sessions.controller'

@Module({
    imports: [SessionsModule, ProjectsModule],
    controllers: [SessionsController],
})
export class SessionsControllerModule {}
