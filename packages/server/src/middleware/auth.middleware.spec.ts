import type { NextFunction, Request, Response } from 'express'
import type { AppOptions } from '../infrastructure/config/options'
import { TokenService } from '../infrastructure/token/token.service'
import { AuthMiddleware } from './auth.middleware'

function fakeResponse() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        cookies: {} as Record<string, { value: string; options: Record<string, unknown> }>,
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
        json: vi.fn((body: unknown) => {
            res.body = body
            return res
        }),
        cookie: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
            res.cookies[name] = { value, options }
            return res
        }),
        redirect: vi.fn((url: string) => {
            res.redirectedTo = url
        }),
    }
    return res
}

function request(overrides: Partial<Request>): Request {
    return {
        method: 'GET',
        path: '/',
        query: {},
        headers: {},
        originalUrl: '/',
        ...overrides,
    } as Request
}

const options = (auth: AppOptions['auth']): AppOptions => ({
    command: 'serve',
    port: 0,
    host: '127.0.0.1',
    noOpen: true,
    auth,
    rotate: false,
})

describe('AuthMiddleware', () => {
    let middleware: AuthMiddleware
    let next: NextFunction

    beforeEach(() => {
        vi.stubEnv('JOHNNY_TOKEN', 'secret')
        middleware = new AuthMiddleware(new TokenService(), options('token'))
        next = vi.fn()
    })

    afterEach(() => vi.unstubAllEnvs())

    it('exchanges a valid ?token= for a long-lived cookie and redirects without it', () => {
        const res = fakeResponse()
        middleware.use(
            request({
                query: { token: 'secret' },
                originalUrl: '/sessions/abc?token=secret&x=1',
                headers: { 'x-forwarded-proto': 'https' },
            }),
            res as unknown as Response,
            next,
        )
        expect(res.cookies.johnny_token?.value).toBe('secret')
        expect(res.cookies.johnny_token?.options).toMatchObject({
            httpOnly: true,
            sameSite: 'lax',
            secure: true,
            maxAge: 90 * 24 * 60 * 60 * 1000,
        })
        expect(res.redirectedTo).toBe('/sessions/abc?x=1')
        expect(next).not.toHaveBeenCalled()
    })

    it('leaves the cookie non-secure on plain http', () => {
        const res = fakeResponse()
        middleware.use(request({ query: { token: 'secret' } }), res as unknown as Response, next)
        expect(res.cookies.johnny_token?.options.secure).toBe(false)
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

    it('sends a browser without credentials to the login page, keeping where it was going', () => {
        const res = fakeResponse()
        middleware.use(
            request({
                originalUrl: '/sessions/abc',
                path: '/sessions/abc',
                headers: { accept: 'text/html,*/*' },
            }),
            res as unknown as Response,
            next,
        )
        expect(res.redirectedTo).toBe('/login?next=%2Fsessions%2Fabc')
        expect(next).not.toHaveBeenCalled()
    })

    it('answers API and non-browser requests without credentials with 401', () => {
        const res = fakeResponse()
        middleware.use(
            request({
                originalUrl: '/api/sessions',
                path: '/api/sessions',
                headers: { accept: 'text/html' },
            }),
            res as unknown as Response,
            next,
        )
        expect(res.statusCode).toBe(401)
        expect(res.redirectedTo).toBeUndefined()
    })

    it('checks nothing in proxy auth mode', () => {
        middleware = new AuthMiddleware(new TokenService(), options('proxy'))
        const res = fakeResponse()
        middleware.use(request({}), res as unknown as Response, next)
        expect(next).toHaveBeenCalled()
        expect(res.statusCode).toBe(200)
    })
})
