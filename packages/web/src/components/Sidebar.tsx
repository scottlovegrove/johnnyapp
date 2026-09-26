import { useState } from "react";
import { Plus } from "lucide-react";
import type { AgentInfo, SessionInfo } from "@johnny/shared";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface Props {
  agents: AgentInfo[];
  sessions: SessionInfo[];
  activeId: string | null;
  status: "connecting" | "open" | "closed";
  onSelect(id: string): void;
  onCreate(agentId: string, cwd: string): Promise<void>;
}

export function Sidebar({ agents, sessions, activeId, status, onSelect, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const effectiveAgent = agentId || agents[0]?.id || "";

  async function submit() {
    if (!cwd || !effectiveAgent) return;
    setSubmitting(true);
    try {
      await onCreate(effectiveAgent, cwd);
      setCreating(false);
      setCwd("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-semibold">Johnny</span>
        <span
          className={cn(
            "size-2 rounded-full",
            status === "open" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500" : "bg-red-500",
          )}
          title={`websocket ${status}`}
        />
      </div>

      <div className="px-3 pb-2">
        {creating ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={effectiveAgent}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.available}>
                  {a.name}
                  {a.available ? "" : ` (${a.reason ?? "unavailable"})`}
                </option>
              ))}
            </select>
            <input
              autoFocus
              className="h-8 rounded-md border bg-background px-2 text-sm"
              placeholder="/absolute/path/to/project"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={submitting || !cwd}>
                Start
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setCreating(true)}>
            <Plus /> New session
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              s.id === activeId && "bg-accent",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="truncate">{s.title}</span>
              {s.busy && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
            </div>
            <div className="truncate text-xs text-muted-foreground">{s.agentId}</div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
