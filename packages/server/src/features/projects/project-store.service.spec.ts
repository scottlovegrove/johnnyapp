import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from '../../infrastructure/token/token.service'
import { ProjectStoreService } from './project-store.service'

const FILE = join(CONFIG_DIR, 'projects.json')

describe('ProjectStoreService', () => {
    let dir: string

    beforeEach(() => {
        rmSync(FILE, { force: true })
        dir = mkdtempSync(join(tmpdir(), 'johnny-project-'))
    })

    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('registers a directory, names it after its basename and persists it', () => {
        const store = new ProjectStoreService()
        const project = store.add(dir)

        expect(project).toMatchObject({ path: dir, name: dir.split('/').pop() })
        expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual([project])
        expect(new ProjectStoreService().list()).toEqual([project])
    })

    it('expands ~ and resolves relative segments', () => {
        vi.stubEnv('HOME', tmpdir())
        const project = new ProjectStoreService().add(`~/${dir.split('/').pop()}/./`)
        vi.unstubAllEnvs()
        expect(project.path).toBe(dir)
    })

    it('rejects paths that are not directories', () => {
        const store = new ProjectStoreService()
        expect(() => store.add(join(dir, 'missing'))).toThrow('Not a directory')
        expect(store.list()).toEqual([])
    })

    it('returns the existing project when the same path is added twice', () => {
        const store = new ProjectStoreService()
        const first = store.add(dir)
        expect(store.add(`${dir}/`)).toBe(first)
        expect(store.list()).toHaveLength(1)
    })

    it('removes by id', () => {
        const store = new ProjectStoreService()
        const project = store.add(dir)
        expect(store.remove(project.id)).toBe(true)
        expect(store.remove(project.id)).toBe(false)
        expect(store.get(project.id)).toBeUndefined()
        expect(new ProjectStoreService().list()).toEqual([])
    })
})
