import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_PIPE } from '@nestjs/core'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ZodValidationPipe } from 'nestjs-zod'
import { AgentsControllerModule } from '../controllers/agents/agents.module'
import { PingModule } from '../controllers/ping/ping.module'
import { ProjectsControllerModule } from '../controllers/projects/projects.module'
import { SessionsControllerModule } from '../controllers/sessions/sessions.module'
import { WebSocketModule } from '../controllers/websocket/websocket.module'
import { AppOptionsModule } from '../infrastructure/config/app-options.module'
import { TokenModule } from '../infrastructure/token/token.module'
import { AuthMiddleware } from '../middleware/auth.middleware'
import { MiddlewareModule } from '../middleware/middleware.module'

// The built SPA is copied to ./public when packaging; during development fall
// back to the sibling web package's build output.
const publicDir = [
    join(__dirname, '..', '..', 'public'),
    join(__dirname, '..', '..', '..', 'web', 'dist'),
].find(existsSync)

@Module({
    imports: [
        ...(publicDir
            ? [
                  ServeStaticModule.forRoot({
                      rootPath: publicDir,
                      exclude: ['/api/{*path}', '/ws'],
                  }),
              ]
            : []),

        // Infrastructure
        AppOptionsModule,
        TokenModule,
        MiddlewareModule,

        // Controllers
        AgentsControllerModule,
        PingModule,
        ProjectsControllerModule,
        SessionsControllerModule,
        WebSocketModule,
    ],
    providers: [
        {
            provide: APP_PIPE,
            useClass: ZodValidationPipe,
        },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).exclude('api/ping').forRoutes('*')
    }
}
