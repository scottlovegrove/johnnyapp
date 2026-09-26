import { Module } from '@nestjs/common'
import { ProjectStoreService } from './project-store.service'

@Module({
    providers: [ProjectStoreService],
    exports: [ProjectStoreService],
})
export class ProjectsModule {}
