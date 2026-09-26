#!/usr/bin/env node
import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app/app.module'
import { type AppOptions, parseOptions } from './infrastructure/config/options'
import { TokenService } from './infrastructure/token/token.service'

/** `johnny token [--rotate]`: print the access token, optionally replacing it first. */
function tokenCommand(options: AppOptions): void {
    const tokens = new TokenService()
    if (options.rotate) {
        tokens.rotate()
        console.error('Token rotated; every signed-in browser will need the new one.')
    }
    console.log(tokens.token)
}

async function serve(options: AppOptions): Promise<void> {
    const logger = new Logger('Johnny')
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: process.env.JOHNNY_DEBUG
            ? ['log', 'error', 'warn', 'debug', 'verbose']
            : ['log', 'error', 'warn'],
    })
    app.disable('x-powered-by')
    // Behind a reverse proxy the client address comes from X-Forwarded-For;
    // the login rate limit keys on it.
    app.set('trust proxy', 'loopback, linklocal, uniquelocal')
    app.useWebSocketAdapter(new WsAdapter(app))
    app.enableShutdownHooks()

    await app.listen(options.port, options.host)

    const displayHost =
        options.host === '0.0.0.0' || options.host === '::' ? 'localhost' : options.host
    const base = `http://${displayHost}:${options.port}`
    if (options.auth === 'proxy') {
        logger.warn(
            'Auth mode is "proxy": Johnny is NOT checking any credentials. Only run this behind a reverse proxy that authenticates every request.',
        )
        logger.log(`Listening on ${base}`)
    } else {
        logger.log(`Listening on ${base}  (sign in at ${base}/login, or run \`johnny token\`)`)
    }

    if (!options.noOpen) {
        const { default: open } = await import('open')
        const url =
            options.auth === 'proxy' ? base : `${base}/?token=${app.get(TokenService).token}`
        await open(url)
    }
}

async function main(): Promise<void> {
    const options = parseOptions()
    if (options.command === 'token') {
        tokenCommand(options)
        return
    }
    await serve(options)
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
