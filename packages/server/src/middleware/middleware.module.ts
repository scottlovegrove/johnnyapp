import { Module } from '@nestjs/common'
import { AuthMiddleware } from './auth.middleware'

@Module({
    providers: [AuthMiddleware],
    exports: [AuthMiddleware],
})
export class MiddlewareModule {}
