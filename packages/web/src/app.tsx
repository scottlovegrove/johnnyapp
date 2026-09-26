import { useCallback, useEffect, useState } from 'react'
import type {
    AgentInfo,
    PermissionRequest,
    Project,
    SessionInfo,
    TranscriptItem,
} from '@johnny/shared'
import { Composer } from './components/composer'
import { PermissionBar } from './components/permission-bar'
import { Sidebar } from './components/sidebar'
import { Transcript } from './components/transcript'
import { socket, useSocket, useSocketStatus } from './lib/ws'

export default function App() {
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [projects, setProjects] = useState<Project[]>([])
    const [sessions, setSessions] = useState<SessionInfo[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)
    const [transcript, setTranscript] = useState<TranscriptItem[]>([])
    const [pending, setPending] = useState<PermissionRequest | null>(null)
    const [error, setError] = useState<string | null>(null)
    const status = useSocketStatus()

    useEffect(() => {
        fetch('/api/agents')
            .then((r) => r.json())
            .then(setAgents)
        fetch('/api/projects')
            .then((r) => r.json())
            .then(setProjects)
        fetch('/api/sessions')
            .then((r) => r.json())
            .then(setSessions)
    }, [])

    useEffect(() => {
        if (!activeId) return
        setTranscript([])
        setPending(null)
        socket.send({ event: 'subscribe', data: { sessionId: activeId } })
    }, [activeId])

    useSocket((msg) => {
        switch (msg.type) {
            case 'session':
                setSessions((prev) => {
                    const i = prev.findIndex((s) => s.id === msg.session.id)
                    if (i === -1) return [msg.session, ...prev]
                    const next = [...prev]
                    next[i] = msg.session
                    return next
                })
                break
            case 'transcript':
                if (msg.sessionId !== activeId) return
                setTranscript(msg.items)
                setPending(msg.pending)
                break
            case 'item':
                if (msg.sessionId !== activeId) return
                setTranscript((prev) => [...prev, msg.item])
                break
            case 'permission_request':
                if (msg.request.sessionId === activeId) setPending(msg.request)
                break
            case 'permission_resolved':
                setPending((p) => (p?.requestId === msg.requestId ? null : p))
                break
            case 'error':
                setError(msg.message)
                break
        }
    })

    async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
        setError(null)
        const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
        if (res.status === 204) return null
        const body = (await res.json()) as T | { error: string }
        if (!res.ok || (body && typeof body === 'object' && 'error' in body)) {
            setError(
                body && typeof body === 'object' && 'error' in body
                    ? body.error
                    : `HTTP ${res.status}`,
            )
            throw new Error('request failed')
        }
        return body as T
    }

    const createSession = useCallback(async (agentId: string, projectId: string) => {
        const session = await api<SessionInfo>('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ agentId, projectId }),
        }).catch(() => null)
        if (!session) return
        setSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [session, ...prev]))
        setActiveId(session.id)
    }, [])

    const importSessions = useCallback(async (agentId: string, projectId: string) => {
        const added = await api<SessionInfo[]>('/api/sessions/import', {
            method: 'POST',
            body: JSON.stringify({ agentId, projectId }),
        }).catch(() => null)
        if (!added) return
        setSessions((prev) => [...added.filter((a) => !prev.some((s) => s.id === a.id)), ...prev])
    }, [])

    const removeSession = useCallback(async (id: string) => {
        await api(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => null)
        setSessions((prev) => prev.filter((s) => s.id !== id))
        setActiveId((current) => (current === id ? null : current))
    }, [])

    const addProject = useCallback(async (path: string) => {
        const project = await api<Project>('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ path }),
        }).catch(() => null)
        if (!project) throw new Error('add failed')
        setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]))
    }, [])

    const removeProject = useCallback(async (id: string) => {
        await api(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => null)
        setProjects((prev) => prev.filter((p) => p.id !== id))
    }, [])

    const active = sessions.find((s) => s.id === activeId) ?? null

    return (
        <div className="flex h-screen">
            <Sidebar
                agents={agents}
                projects={projects}
                sessions={sessions}
                activeId={activeId}
                onSelect={setActiveId}
                onCreateSession={createSession}
                onImportSessions={importSessions}
                onRemoveSession={removeSession}
                onAddProject={addProject}
                onRemoveProject={removeProject}
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
                        <Transcript
                            items={transcript}
                            busy={active.busy}
                            resuming={active.resuming}
                        />
                        {pending && (
                            <PermissionBar
                                request={pending}
                                onChoose={(optionId) =>
                                    socket.send({
                                        event: 'permission',
                                        data: { requestId: pending.requestId, optionId },
                                    })
                                }
                            />
                        )}
                        <Composer
                            busy={active.busy}
                            onSend={(text) =>
                                socket.send({
                                    event: 'prompt',
                                    data: { sessionId: active.id, text },
                                })
                            }
                            onCancel={() =>
                                socket.send({ event: 'cancel', data: { sessionId: active.id } })
                            }
                        />
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        Add a project, then start a session from it.
                    </div>
                )}
            </main>
        </div>
    )
}
