import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AgentInfo } from "@johnny/shared";
import { AcpAgent, type AcpAgentSpec } from "./acp.js";
import type { AgentAdapter, AgentEvents } from "./types.js";

const require = createRequire(import.meta.url);

/**
 * Locate the bin script of a bundled ACP adapter package so it can be run with
 * the same Node binary that runs Johnny, regardless of the user's PATH or
 * version manager.
 */
function bundledBin(pkg: string, binName: string): string {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgJson = require(pkgJsonPath) as { bin?: string | Record<string, string> };
  const rel = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.[binName];
  if (!rel) throw new Error(`${pkg} has no bin "${binName}"`);
  return join(dirname(pkgJsonPath), rel);
}

const specs: AcpAgentSpec[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: process.execPath,
    args: [bundledBin("@zed-industries/claude-code-acp", "claude-code-acp")],
  },
];

export class AgentRegistry {
  private adapters = new Map<string, AgentAdapter>();
  private failures = new Map<string, string>();

  constructor(private readonly events: (agentId: string) => AgentEvents) {}

  list(): AgentInfo[] {
    return specs.map((s) => {
      const reason = this.failures.get(s.id);
      return { id: s.id, name: s.name, available: !reason, reason };
    });
  }

  /** Get a running adapter, starting it on first use. */
  async get(agentId: string): Promise<AgentAdapter> {
    const existing = this.adapters.get(agentId);
    if (existing) return existing;

    const spec = specs.find((s) => s.id === agentId);
    if (!spec) throw new Error(`Unknown agent "${agentId}"`);

    const adapter = new AcpAgent(spec);
    const baseEvents = this.events(agentId);
    try {
      await adapter.start({
        ...baseEvents,
        closed: (err) => {
          this.adapters.delete(agentId);
          baseEvents.closed(err);
        },
      });
    } catch (err) {
      this.failures.set(agentId, err instanceof Error ? err.message : String(err));
      throw err;
    }
    this.failures.delete(agentId);
    this.adapters.set(agentId, adapter);
    return adapter;
  }

  stopAll(): void {
    for (const a of this.adapters.values()) a.stop();
    this.adapters.clear();
  }
}
