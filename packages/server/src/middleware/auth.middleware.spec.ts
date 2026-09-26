import type { NextFunction, Request, Response } from 'express'
import { TokenService } from '../infrastructure/token/token.service'
import { AuthMiddleware } from './auth.middleware'

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        cookies: {} as Record<string, string>,
        redirectedTo: undefined as string | undefined,
        status: vi.fn((code: number) => {
            res.statusCode = code
            return res
        }),
        type: vi.fn(() => res),
        send: vi.fn((body: unknown) => {
            res.body = body
            return res
        }),
        cookie: vi.fn((name: string, value: string) => {
            res.cookies[name] = value
            return res
        }),
        redirect: vi.fn((url: string) => {
            res.redirectedTo = url
        }),
    }
    return res
}

function request(overrides: Partial<Request>): Request {
    return { query: {}, headers: {}, originalUrl: '/', ...overrides } as Request
}

describe('AuthMiddleware', () => {
    let middleware: AuthMiddleware
    let next: NextFunction

    beforeEach(() => {
        vi.stubEnv('JOHNNY_TOKEN', 'secret')
        middleware = new AuthMiddleware(new TokenService())
        next = vi.fn()
    })

    afterEach(() => vi.unstubAllEnvs())

    it('exchanges a valid ?token= for a cookie and redirects without it', () => {
        const res = fakeResponse()
        middleware.use(
            request({ query: { token: 'secret' }, originalUrl: '/some/page?token=secret&x=1' }),
            res as unknown as Response,
            next,
        )
        expect(res.cookies.johnny_token).toBe('secret')
        expect(res.redirectedTo).toBe('/some/page?x=1')
        expect(next).not.toHaveBeenCalled()
    })

    it('rejects a wrong ?token= with 403', () => {
        const res = fakeResponse()
        middleware.use(request({ query: { token: 'nope' } }), res as unknown as Response, next)
        expect(res.statusCode).toBe(403)
        expect(res.cookies).toEqual({})
        expect(next).not.toHaveBeenCalled()
    })

    it('lets a request with the token cookie through', () => {
        const res = fakeResponse()
        middleware.use(
            request({ headers: { cookie: 'johnny_token=secret' } }),
            res as unknown as Response,
            next,
        )
        expect(next).toHaveBeenCalled()
    })

    it('rejects a request with no credentials with 401', () => {
        const res = fakeResponse()
        middleware.use(request({}), res as unknown as Response, next)
        expect(res.statusCode).toBe(401)
        expect(next).not.toHaveBeenCalled()
    })
})
