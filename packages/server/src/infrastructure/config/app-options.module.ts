import { Global, Module } from '@nestjs/common'
import { APP_OPTIONS, parseOptions } from './options'

@Global()
@Module({
    providers: [{ provide: APP_OPTIONS, useFactory: parseOptions }],
    exports: [APP_OPTIONS],
})
export class AppOptionsModule {}
