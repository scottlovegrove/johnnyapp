import { Module } from '@nestjs/common'
import { LoginAttemptsService } from './login-attempts.service'

@Module({
    providers: [LoginAttemptsService],
    exports: [LoginAttemptsService],
})
export class AuthModule {}
