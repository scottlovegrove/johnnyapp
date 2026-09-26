import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { APP_OPTIONS, type AppOptions } from '../infrastructure/config/options'
import { COOKIE_NAME, TokenService } from '../infrastructure/token/token.service'

/** Only paths on this origin, so `next` can never send the browser elsewhere. */
export function safeNextPath(next: unknown): string {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

/**
 * Every request must carry the token: as a `?token=` query param (exchanged
 * for a cookie and redirected away), or as the cookie the login page sets.
 * Anyone who can reach this server can run shell commands via the agent, so
 * nothing but the health check and the login page is served without it. In
 * `proxy` auth mode the check is skipped entirely because something in front
 * of Johnny already did it.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
    private readonly tokens: TokenService
    private readonly options: AppOptions

    constructor(tokens: TokenService, @Inject(APP_OPTIONS) options: AppOptions) {
        this.tokens = tokens
        this.options = options
    }

    use(req: Request, res: Response, next: NextFunction) {
        if (this.options.auth === 'proxy') {
            next()
            return
        }

        const fromQuery = req.query.token
        if (typeof fromQuery === 'string') {
            if (!this.tokens.verify(fromQuery)) {
                res.status(403).type('text').send('Forbidden')
                return
            }
            res.cookie(COOKIE_NAME, fromQuery, this.tokens.cookieOptions(req))
            const url = new URL(req.originalUrl, 'http://localhost')
            url.searchParams.delete('token')
            res.redirect(url.pathname + url.search)
            return
        }

        if (this.tokens.verifyCookieHeader(req.headers.cookie)) {
            next()
            return
        }

        // A person navigating gets the login page; scripts and the API get a 401.
        const wantsPage =
            req.method === 'GET' &&
            !req.path.startsWith('/api/') &&
            (req.headers.accept ?? '').includes('text/html')
        if (wantsPage) {
            const next = safeNextPath(req.originalUrl)
            res.redirect(`/login?next=${encodeURIComponent(next)}`)
            return
        }
        res.status(401).json({ statusCode: 401, message: 'Unauthorised' })
    }
}
