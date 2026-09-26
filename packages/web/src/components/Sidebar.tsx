import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Plus, Trash2 } from "lucide-react";
import type { AgentInfo, Project, SessionInfo } from "@johnny/shared";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "johnny.sidebar.collapsed";

interface Props {
  agents: AgentInfo[];
  projects: Project[];
  sessions: SessionInfo[];
  activeId: string | null;
  status: "connecting" | "open" | "closed";
  onSelect(id: string): void;
  onCreateSession(agentId: string, projectId: string): Promise<void>;
  onAddProject(path: string): Promise<void>;
  onRemoveProject(id: string): Promise<void>;
}

export function Sidebar({
  agents,
  projects,
  sessions,
  activeId,
  status,
  onSelect,
  onCreateSession,
  onAddProject,
  onRemoveProject,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      // storage unavailable; collapse state is per-tab only
    }
  }, [collapsed]);

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agentId || availableAgents[0]?.id || "";

  async function addProject() {
    if (!path.trim()) return;
    setBusy(true);
    try {
      await onAddProject(path.trim());
      setAdding(false);
      setPath("");
    } finally {
      setBusy(false);
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

      {availableAgents.length > 1 && (
        <div className="px-3 pb-2">
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={selectedAgent}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.available}>
                {a.name}
                {a.available ? "" : ` (${a.reason ?? "unavailable"})`}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2">
        {projects.length === 0 && !adding && (
          <p className="px-2 py-4 text-xs text-muted-foreground">Add a project directory to get started.</p>
        )}
        {projects.map((p) => {
          const own = sessions.filter((s) => s.projectId === p.id);
          const isCollapsed = !!collapsed[p.id];
          const Chevron = isCollapsed ? ChevronRight : ChevronDown;
          return (
            <section key={p.id} className="mb-2">
              <div className="group flex items-center gap-1 px-1 py-1">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-accent"
                  onClick={() => toggle(p.id)}
                  aria-expanded={!isCollapsed}
                >
                  <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{p.name}</span>
                      {isCollapsed && own.length > 0 && (
                        <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{own.length}</span>
                      )}
                    </div>
                    {!isCollapsed && (
                      <div className="truncate text-[11px] text-muted-foreground" title={p.path}>
                        {p.path}
                      </div>
                    )}
                  </div>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="New session"
                  disabled={!selectedAgent}
                  onClick={() => void onCreateSession(selectedAgent, p.id)}
                >
                  <Plus />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 opacity-0 group-hover:opacity-100"
                  title="Remove project"
                  onClick={() => void onRemoveProject(p.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              {!isCollapsed &&
                own.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1 pl-6 text-left text-sm hover:bg-accent",
                      s.id === activeId && "bg-accent",
                    )}
                  >
                    <span className="truncate">{s.title}</span>
                    {s.busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />}
                  </button>
                ))}
            </section>
          );
        })}
      </nav>

      <div className="border-t p-2">
        {adding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addProject();
            }}
          >
            <input
              autoFocus
              className="h-8 rounded-md border bg-background px-2 text-sm"
              placeholder="/path/to/project or ~/project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !path.trim()}>
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setAdding(true)}>
            <FolderPlus /> Add project
          </Button>
        )}
      </div>
    </aside>
  );
}
