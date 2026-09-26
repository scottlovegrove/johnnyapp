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

export interface AgentAdapter {
    readonly id: string
    readonly name: string
    start(events: AgentEvents): Promise<void>
    newSession(cwd: string): Promise<string>
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
