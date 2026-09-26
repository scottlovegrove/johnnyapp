import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Project } from '@johnny/shared'
import { CONFIG_DIR } from './auth.js'

const FILE = join(CONFIG_DIR, 'projects.json')

/** Registered project directories, persisted as JSON in the config dir. */
export class ProjectStore {
    private projects: Project[] = []

    constructor() {
        if (existsSync(FILE)) {
            this.projects = JSON.parse(readFileSync(FILE, 'utf8')) as Project[]
        }
    }

    list(): Project[] {
        return this.projects
    }

    get(id: string): Project | undefined {
        return this.projects.find((p) => p.id === id)
    }

    add(rawPath: string, name?: string): Project {
        const path = resolve(rawPath.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'))
        if (!existsSync(path) || !statSync(path).isDirectory()) {
            throw new Error(`Not a directory: ${path}`)
        }
        const existing = this.projects.find((p) => p.path === path)
        if (existing) return existing

        const project: Project = {
            id: randomUUID(),
            name: name?.trim() || basename(path),
            path,
            createdAt: new Date().toISOString(),
        }
        this.projects.push(project)
        this.save()
        return project
    }

    remove(id: string): boolean {
        const before = this.projects.length
        this.projects = this.projects.filter((p) => p.id !== id)
        if (this.projects.length === before) return false
        this.save()
        return true
    }

    private save(): void {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        writeFileSync(FILE, JSON.stringify(this.projects, null, 2) + '\n')
    }
}
