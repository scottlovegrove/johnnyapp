import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
import type { SessionInfo } from '@johnny/shared'
import { CONFIG_DIR } from '../../infrastructure/token/token.service'

const FILE = join(CONFIG_DIR, 'sessions.json')

/** What survives a restart: everything about a session except its live state. */
export type SessionRecord = Omit<SessionInfo, 'busy' | 'resuming'>

interface StoreFile {
    sessions: SessionRecord[]
    /** Sessions the user removed; the agent still has them, so imports skip them. */
    ignored: string[]
}

/**
 * The index of sessions Johnny knows about, persisted as JSON in the config
 * dir. Transcripts are not stored here; the agent keeps those and replays them
 * on demand.
 */
@Injectable()
export class SessionStoreService {
    private records = new Map<string, SessionRecord>()
    private ignored = new Set<string>()

    constructor() {
        if (!existsSync(FILE)) return
        const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as StoreFile | SessionRecord[]
        // Earlier versions wrote a bare array of sessions.
        const file: StoreFile = Array.isArray(parsed) ? { sessions: parsed, ignored: [] } : parsed
        this.records = new Map(file.sessions.map((r) => [r.id, r]))
        this.ignored = new Set(file.ignored ?? [])
    }

    list(): SessionRecord[] {
        return [...this.records.values()]
    }

    get(id: string): SessionRecord | undefined {
        return this.records.get(id)
    }

    upsert(info: SessionInfo | SessionRecord): void {
        const { busy: _busy, resuming: _resuming, ...record } = info as SessionInfo
        this.records.set(record.id, record)
        this.ignored.delete(record.id)
        this.save()
    }

    /** Forget a session and keep it out of future imports. */
    remove(id: string): boolean {
        const removed = this.records.delete(id)
        this.ignored.add(id)
        this.save()
        return removed
    }

    isIgnored(id: string): boolean {
        return this.ignored.has(id)
    }

    private save(): void {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        const file: StoreFile = { sessions: this.list(), ignored: [...this.ignored] }
        writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n')
    }
}
