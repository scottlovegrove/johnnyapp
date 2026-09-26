import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
import type { SessionInfo } from '@johnny/shared'
import { CONFIG_DIR } from '../../infrastructure/token/token.service'

const FILE = join(CONFIG_DIR, 'sessions.json')

/** What survives a restart: everything about a session except its live state. */
export type SessionRecord = Omit<SessionInfo, 'busy'>

/**
 * The index of sessions Johnny knows about, persisted as JSON in the config
 * dir. Transcripts are not stored here; the agent keeps those and replays them
 * on demand.
 */
@Injectable()
export class SessionStoreService {
    private records = new Map<string, SessionRecord>()

    constructor() {
        if (existsSync(FILE)) {
            const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as SessionRecord[]
            this.records = new Map(parsed.map((r) => [r.id, r]))
        }
    }

    list(): SessionRecord[] {
        return [...this.records.values()]
    }

    get(id: string): SessionRecord | undefined {
        return this.records.get(id)
    }

    upsert(info: SessionInfo | SessionRecord): void {
        const { busy: _busy, ...record } = info as SessionInfo
        this.records.set(record.id, record)
        this.save()
    }

    remove(id: string): boolean {
        const removed = this.records.delete(id)
        if (removed) this.save()
        return removed
    }

    private save(): void {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        writeFileSync(FILE, JSON.stringify(this.list(), null, 2) + '\n')
    }
}
