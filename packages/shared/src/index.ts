import type {
    PermissionOption,
    SessionUpdate,
    StopReason,
    ToolCallUpdate,
} from '@agentclientprotocol/sdk'

export type { SessionUpdate, StopReason, ToolCallUpdate, PermissionOption }

/** An agent backend the server knows how to drive. */
export interface AgentInfo {
    id: string
    name: string
    available: boolean
    /** Human-readable reason when `available` is false. */
    reason?: string
}

/** A directory the user has registered; sessions are started inside one. */
export interface Project {
    id: string
    name: string
    path: string
    createdAt: string
}

export interface SessionInfo {
    id: string
    agentId: string
    projectId: string
    cwd: string
    title: string
    createdAt: string
    /** Last time a prompt was sent, or the agent's own timestamp for imported sessions. */
    lastActiveAt: string
    /** Whether the session was started from Johnny or picked up from the agent's own history. */
    origin: 'johnny' | 'agent'
    /** True while a prompt turn is in flight. */
    busy: boolean
    /** True while the agent is re-attaching to the session and replaying its history. */
    resuming: boolean
}

/** A single stored item in a session's transcript. */
export type TranscriptItem =
    | { kind: 'user'; id: string; text: string; at: string }
    | { kind: 'update'; id: string; update: SessionUpdate; at: string }
    | { kind: 'turn_end'; id: string; stopReason: StopReason; at: string }
    | { kind: 'error'; id: string; message: string; at: string }

export interface PermissionRequest {
    requestId: string
    sessionId: string
    toolCall: ToolCallUpdate
    options: PermissionOption[]
}

/**
 * Browser → server over the websocket. Uses the `{ event, data }` envelope the
 * server's websocket layer dispatches on.
 */
export type ClientMessage =
    | { event: 'subscribe'; data: { sessionId: string } }
    | { event: 'prompt'; data: { sessionId: string; text: string } }
    | { event: 'cancel'; data: { sessionId: string } }
    | { event: 'permission'; data: { requestId: string; optionId: string | null } }

/** Server → browser over the websocket. */
export type ServerMessage =
    | { type: 'session'; session: SessionInfo }
    | {
          type: 'transcript'
          sessionId: string
          items: TranscriptItem[]
          pending: PermissionRequest | null
      }
    | { type: 'item'; sessionId: string; item: TranscriptItem }
    | { type: 'permission_request'; request: PermissionRequest }
    | { type: 'permission_resolved'; requestId: string }
    | { type: 'error'; sessionId?: string; message: string }
