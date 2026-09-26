import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionInfo } from '@johnny/shared'
import { CONFIG_DIR } from '../../infrastructure/token/token.service'
import { SessionStoreService } from './session-store.service'

const FILE = join(CONFIG_DIR, 'sessions.json')

const info: SessionInfo = {
    id: 's1',
    agentId: 'claude-code',
    projectId: 'p1',
    cwd: '/tmp/proj',
    title: 'Session 10:00',
    createdAt: '2026-01-01T10:00:00.000Z',
    lastActiveAt: '2026-01-01T10:00:00.000Z',
    origin: 'johnny',
    busy: true,
}

describe('SessionStoreService', () => {
    beforeEach(() => rmSync(FILE, { force: true }))

    it('persists everything but live state and reads it back in a new instance', () => {
        new SessionStoreService().upsert(info)

        const { busy: _busy, ...record } = info
        expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual([record])
        const reloaded = new SessionStoreService()
        expect(reloaded.list()).toEqual([record])
        expect(reloaded.get('s1')).toEqual(record)
    })

    it('upsert replaces an existing record and remove drops it', () => {
        const store = new SessionStoreService()
        store.upsert(info)
        store.upsert({ ...info, title: 'Renamed' })
        expect(store.list()).toHaveLength(1)
        expect(store.get('s1')?.title).toBe('Renamed')

        expect(store.remove('s1')).toBe(true)
        expect(store.remove('s1')).toBe(false)
        expect(new SessionStoreService().list()).toEqual([])
    })
})
