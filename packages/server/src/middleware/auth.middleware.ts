import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { COOKIE_NAME, TokenService } from '../infrastructure/token/token.service'

/**
 * Every request must carry the token, either as a `?token=` query param (which
 * is exchanged for a cookie and redirected away) or as the cookie itself.
 * Anyone who can reach this server can run shell commands via the agent, so
 * nothing but the health check is served without it.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
    private readonly tokens: TokenService

    constructor(tokens: TokenService) {
        this.tokens = tokens
    }

    use(req: Request, res: Response, next: NextFunction) {
        const fromQuery = req.query.token
        if (typeof fromQuery === 'string') {
            if (!this.tokens.verify(fromQuery)) {
                res.status(403).type('text').send('Forbidden')
                return
            }
            res.cookie(COOKIE_NAME, fromQuery, { httpOnly: true, sameSite: 'lax', path: '/' })
            const url = new URL(req.originalUrl, 'http://localhost')
            url.searchParams.delete('token')
            res.redirect(url.pathname + url.search)
            return
        }

        if (this.tokens.verifyCookieHeader(req.headers.cookie)) {
            next()
            return
        }
        res.status(401).type('text').send('Unauthorised. Open the URL printed when Johnny started.')
    }
}
