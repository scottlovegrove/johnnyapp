import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
import type { CookieOptions } from 'express'

export const CONFIG_DIR = process.env.JOHNNY_CONFIG_DIR ?? join(homedir(), '.config', 'johnny')
const TOKEN_FILE = join(CONFIG_DIR, 'token')

export const COOKIE_NAME = 'johnny_token'
const COOKIE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

function generateToken(): string {
    return randomBytes(24).toString('base64url')
}

/**
 * The single shared secret that gates every request. Generated on first run
 * and stored in the config dir; `JOHNNY_TOKEN` overrides it.
 */
@Injectable()
export class TokenService {
    private current: string

    constructor() {
        this.current = TokenService.load()
    }

    get token(): string {
        return this.current
    }

    verify(candidate: string | undefined): boolean {
        if (!candidate) return false
        const a = Buffer.from(candidate)
        const b = Buffer.from(this.current)
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

    /**
     * Attributes for the login cookie. `Secure` is set when the request came
     * over HTTPS, directly or through a reverse proxy that says so, so the
     * cookie still works on plain-HTTP localhost.
     */
    cookieOptions(req: IncomingMessage & { secure?: boolean }): CookieOptions {
        const forwarded = req.headers['x-forwarded-proto']
        const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()
        return {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: COOKIE_MAX_AGE_MS,
            secure: req.secure === true || proto === 'https',
        }
    }

    /**
     * Replace the stored token, invalidating every browser that holds the old
     * one. Not possible when the token comes from `JOHNNY_TOKEN`.
     */
    rotate(): string {
        if (process.env.JOHNNY_TOKEN) {
            throw new Error('The token is set by JOHNNY_TOKEN; change it there instead')
        }
        this.current = generateToken()
        TokenService.store(this.current)
        return this.current
    }

    private static load(): string {
        if (process.env.JOHNNY_TOKEN) return process.env.JOHNNY_TOKEN
        if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim()
        const token = generateToken()
        TokenService.store(token)
        return token
    }

    private static store(token: string): void {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
    }
}
