import type {
    PermissionOption,
    SessionUpdate,
    StopReason,
    ToolCallUpdate,
} from '@agentclientprotocol/sdk'

export interface AgentEvents {
    /** Streamed update for a session (text chunk, tool call, plan, …). */
    update(sessionId: string, update: SessionUpdate): void
    /**
     * The agent wants to run something that needs approval. Resolve the returned
     * promise with the chosen option, or `null` to cancel.
     */
    permission(
        sessionId: string,
        toolCall: ToolCallUpdate,
        options: PermissionOption[],
    ): Promise<string | null>
    /** The adapter process died or the connection closed. */
    closed(error?: unknown): void
}

export interface AgentCapabilities {
    /** `loadSession`: re-attach to a stored session and replay its history. */
    loadSession: boolean
    /** `resumeSession`: re-attach without replaying. */
    resumeSession: boolean
    /** `listSessions`: enumerate the agent's stored sessions for a directory. */
    listSessions: boolean
}

/** A session the agent already knows about, as reported by `listSessions`. */
export interface AgentSessionSummary {
    id: string
    cwd: string
    title: string | null
    updatedAt: string | null
}

export interface AgentAdapter {
    readonly id: string
    readonly name: string
    /** Populated once `start` has completed the handshake. */
    readonly capabilities: AgentCapabilities
    start(events: AgentEvents): Promise<void>
    newSession(cwd: string): Promise<string>
    /**
     * Re-attach to a session from a previous run. The agent replays the
     * session's history through `AgentEvents.update` before this resolves.
     */
    loadSession(sessionId: string, cwd: string): Promise<void>
    /** Re-attach to a session without replaying its history. */
    resumeSession(sessionId: string, cwd: string): Promise<void>
    listSessions(cwd: string): Promise<AgentSessionSummary[]>
    prompt(sessionId: string, text: string): Promise<StopReason>
    cancel(sessionId: string): Promise<void>
    stop(): void
}

export interface AcpAgentSpec {
    id: string
    name: string
    command: string
    args: string[]
    env?: Record<string, string>
}
