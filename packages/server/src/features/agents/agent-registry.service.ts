import { dirname, join } from 'node:path'
import { Injectable, type OnApplicationShutdown } from '@nestjs/common'
import type { AgentInfo } from '@johnny/shared'
import { AcpAgent } from './acp-agent'
import type { AcpAgentSpec, AgentAdapter, AgentEvents } from './agent.types'

/**
 * Locate the bin script of a bundled ACP adapter package so it can be run with
 * the same Node binary that runs Johnny, regardless of the user's PATH or
 * version manager.
 */
function bundledBin(pkg: string, binName: string): string {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`)
    const pkgJson = require(pkgJsonPath) as { bin?: string | Record<string, string> }
    const rel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName]
    if (!rel) throw new Error(`${pkg} has no bin "${binName}"`)
    return join(dirname(pkgJsonPath), rel)
}

const specs: AcpAgentSpec[] = [
    {
        id: 'claude-code',
        name: 'Claude Code',
        command: process.execPath,
        args: [bundledBin('@zed-industries/claude-code-acp', 'claude-code-acp')],
    },
]

@Injectable()
export class AgentRegistryService implements OnApplicationShutdown {
    private readonly adapters = new Map<string, AgentAdapter>()
    private readonly failures = new Map<string, string>()

    list(): AgentInfo[] {
        return specs.map((s) => {
            const reason = this.failures.get(s.id)
            return { id: s.id, name: s.name, available: !reason, reason }
        })
    }

    /**
     * Get a running adapter, starting it on first use. `events` is only used
     * when the adapter has to be started; the first caller's sink stays wired
     * for the adapter's lifetime.
     */
    async get(agentId: string, events: AgentEvents): Promise<AgentAdapter> {
        const existing = this.adapters.get(agentId)
        if (existing) return existing

        const spec = specs.find((s) => s.id === agentId)
        if (!spec) throw new Error(`Unknown agent "${agentId}"`)

        const adapter = new AcpAgent(spec)
        try {
            await adapter.start({
                ...events,
                closed: (err) => {
                    this.adapters.delete(agentId)
                    events.closed(err)
                },
            })
        } catch (err) {
            this.failures.set(agentId, err instanceof Error ? err.message : String(err))
            throw err
        }
        this.failures.delete(agentId)
        this.adapters.set(agentId, adapter)
        return adapter
    }

    onApplicationShutdown(): void {
        for (const a of this.adapters.values()) a.stop()
        this.adapters.clear()
    }
}
