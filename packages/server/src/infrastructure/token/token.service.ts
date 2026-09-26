import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'

export const CONFIG_DIR = process.env.JOHNNY_CONFIG_DIR ?? join(homedir(), '.config', 'johnny')
const TOKEN_FILE = join(CONFIG_DIR, 'token')

export const COOKIE_NAME = 'johnny_token'

/**
 * The single shared secret that gates every request. Generated on first run
 * and stored in the config dir; `JOHNNY_TOKEN` overrides it.
 */
@Injectable()
export class TokenService {
    readonly token: string

    constructor() {
        this.token = TokenService.load()
    }

    verify(candidate: string | undefined): boolean {
        if (!candidate) return false
        const a = Buffer.from(candidate)
        const b = Buffer.from(this.token)
        return a.length === b.length && timingSafeEqual(a, b)
    }

    /** Read the cookie header of a raw request (used for websocket upgrades). */
    verifyCookieHeader(header: string | undefined): boolean {
        if (!header) return false
        for (const part of header.split(';')) {
            const [name, ...rest] = part.trim().split('=')
            if (name === COOKIE_NAME) return this.verify(decodeURIComponent(rest.join('=')))
        }
        return false
    }

    private static load(): string {
        if (process.env.JOHNNY_TOKEN) return process.env.JOHNNY_TOKEN
        if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim()
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        const token = randomBytes(24).toString('base64url')
        writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
        return token
    }
}
