import { Injectable } from '@nestjs/common'

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000

/**
 * Per-address lockout for the login form: after too many wrong tokens in a
 * window, further attempts are refused until the window has passed. In
 * memory only; a restart forgives everyone, which is fine for a single-user
 * tool where the goal is to make guessing impractical, not to keep an audit.
 */
@Injectable()
export class LoginAttemptsService {
    private readonly failures = new Map<string, number[]>()

    allowed(ip: string, now = Date.now()): boolean {
        return this.recent(ip, now).length < MAX_FAILURES
    }

    failed(ip: string, now = Date.now()): void {
        this.failures.set(ip, [...this.recent(ip, now), now])
    }

    reset(ip: string): void {
        this.failures.delete(ip)
    }

    private recent(ip: string, now: number): number[] {
        return (this.failures.get(ip) ?? []).filter((at) => now - at < WINDOW_MS)
    }
}
