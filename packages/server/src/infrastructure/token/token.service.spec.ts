import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR, TokenService } from './token.service'

const TOKEN_FILE = join(CONFIG_DIR, 'token')

describe('TokenService', () => {
    beforeEach(() => {
        rmSync(TOKEN_FILE, { force: true })
        vi.unstubAllEnvs()
    })

    it('generates a token on first run and reuses it afterwards', () => {
        const first = new TokenService().token
        expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/)
        expect(existsSync(TOKEN_FILE)).toBe(true)
        expect(readFileSync(TOKEN_FILE, 'utf8')).toBe(first)

        expect(new TokenService().token).toBe(first)
    })

    it('prefers JOHNNY_TOKEN over the stored token', () => {
        vi.stubEnv('JOHNNY_TOKEN', 'from-env')
        expect(new TokenService().token).toBe('from-env')
        expect(existsSync(TOKEN_FILE)).toBe(false)
    })

    it('verifies exact matches only', () => {
        vi.stubEnv('JOHNNY_TOKEN', 'secret')
        const service = new TokenService()
        expect(service.verify('secret')).toBe(true)
        expect(service.verify('secre')).toBe(false)
        expect(service.verify('secretx')).toBe(false)
        expect(service.verify(undefined)).toBe(false)
    })

    it('finds the token cookie in a raw Cookie header', () => {
        vi.stubEnv('JOHNNY_TOKEN', 'a=b')
        const service = new TokenService()
        expect(service.verifyCookieHeader('other=1; johnny_token=a%3Db; x=y')).toBe(true)
        expect(service.verifyCookieHeader('johnny_token=wrong')).toBe(false)
        expect(service.verifyCookieHeader(undefined)).toBe(false)
    })
})
