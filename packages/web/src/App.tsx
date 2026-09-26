import { useCallback, useEffect, useState } from "react";
import type { AgentInfo, PermissionRequest, SessionInfo, TranscriptItem } from "@johnny/shared";
import { Composer } from "./components/Composer";
import { PermissionBar } from "./components/PermissionBar";
import { Sidebar } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { socket, useSocket, useSocketStatus } from "./lib/ws";

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useSocketStatus();

  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then(setAgents);
    fetch("/api/sessions").then((r) => r.json()).then(setSessions);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setTranscript([]);
    setPending(null);
    socket.send({ type: "subscribe", sessionId: activeId });
  }, [activeId]);

  useSocket((msg) => {
    switch (msg.type) {
      case "session":
        setSessions((prev) => {
          const i = prev.findIndex((s) => s.id === msg.session.id);
          if (i === -1) return [msg.session, ...prev];
          const next = [...prev];
          next[i] = msg.session;
          return next;
        });
        break;
      case "transcript":
        if (msg.sessionId !== activeId) return;
        setTranscript(msg.items);
        setPending(msg.pending);
        break;
      case "item":
        if (msg.sessionId !== activeId) return;
        setTranscript((prev) => [...prev, msg.item]);
        break;
      case "permission_request":
        if (msg.request.sessionId === activeId) setPending(msg.request);
        break;
      case "permission_resolved":
        setPending((p) => (p?.requestId === msg.requestId ? null : p));
        break;
      case "error":
        setError(msg.message);
        break;
    }
  });

  const createSession = useCallback(async (agentId: string, cwd: string) => {
    setError(null);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, cwd }),
    });
    const body = (await res.json()) as SessionInfo | { error: string };
    if (!res.ok || "error" in body) {
      setError("error" in body ? body.error : `HTTP ${res.status}`);
      return;
    }
    setSessions((prev) => (prev.some((s) => s.id === body.id) ? prev : [body, ...prev]));
    setActiveId(body.id);
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="flex h-screen">
      <Sidebar
        agents={agents}
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={createSession}
        status={status}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>{error}</span>
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {active ? (
          <>
            <header className="border-b px-4 py-2 text-sm">
              <span className="font-medium">{active.title}</span>
              <span className="ml-2 text-muted-foreground">{active.cwd}</span>
              <span className="ml-2 text-muted-foreground">· {active.agentId}</span>
            </header>
            <Transcript items={transcript} busy={active.busy} />
            {pending && (
              <PermissionBar
                request={pending}
                onChoose={(optionId) => socket.send({ type: "permission", requestId: pending.requestId, optionId })}
              />
            )}
            <Composer
              busy={active.busy}
              onSend={(text) => socket.send({ type: "prompt", sessionId: active.id, text })}
              onCancel={() => socket.send({ type: "cancel", sessionId: active.id })}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Pick a session or start a new one.
          </div>
        )}
      </main>
    </div>
  );
}
