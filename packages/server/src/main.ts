#!/usr/bin/env node
import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app/app.module'
import { APP_OPTIONS, type AppOptions } from './infrastructure/config/options'
import { TokenService } from './infrastructure/token/token.service'

async function bootstrap() {
    const logger = new Logger('Johnny')
    const app = await NestFactory.create<NestExpressApplication>(AppModule)
    const options = app.get<AppOptions>(APP_OPTIONS)
    app.disable('x-powered-by')
    app.useWebSocketAdapter(new WsAdapter(app))
    app.enableShutdownHooks()

    await app.listen(options.port, options.host)

    const token = app.get(TokenService).token
    const displayHost =
        options.host === '0.0.0.0' || options.host === '::' ? 'localhost' : options.host
    const url = `http://${displayHost}:${options.port}/?token=${token}`
    logger.log(`Listening on ${url}`)

    if (!options.noOpen) {
        const { default: open } = await import('open')
        await open(url)
    }
}

bootstrap().catch((err) => {
    console.error(err)
    process.exit(1)
})
