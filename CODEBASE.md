# CODEBASE.md — Repo Map

> **Purpose:** a ~2000-token orientation file so Claude (and humans) can navigate this repo without exploring. Describes _what is where_; `AGENTS.md` describes _how to change things_. Update when structure shifts, not on every new file.

## What this project is

**Johnny** is a self-hosted web chat that drives the AI coding agents already installed on the user's machine. One local Node process serves a React SPA and talks to agents over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP) via stdio. Claude Code is the first agent, through the bundled `@agentclientprotocol/claude-agent-acp` adapter, which reuses the user's existing Claude Code login.

npm workspaces · Node ≥ 24.15 · NestJS 12 (server) · React 19 + Vite 7 + Tailwind 4 (web) · TypeScript 6 · vitest 4 · oxlint + oxfmt · exact-pinned deps + Renovate · CI on every PR.

## Top-level layout

```
/
├─ packages/
│  ├─ shared/             # Types shared by server and web (no runtime code)
│  ├─ server/             # NestJS app; the publishable `johnny` package
│  └─ web/                # React SPA; built output is copied into server/public
├─ .github/workflows/ci.yml   # lint+format, type-check, test, build
├─ .husky/pre-commit      # type-check + check:fix on staged files
├─ AGENTS.md              # Conventions and rules (prescriptive)
├─ CODEBASE.md            # This file (descriptive)
├─ CLAUDE.md              # Forward to AGENTS.md
├─ README.md              # Run / develop / tooling
├─ renovate.json          # Grouped, automerging dependency updates
├─ tsconfig.base.json     # Strict base; packages extend it
├─ vitest.config.base.ts  # Shared vitest defaults; packages mergeConfig it
└─ .oxlintrc.json / .oxfmtrc.json
```

Root scripts: `dev` (server watch + Vite), `build` (shared → web → server, copies web dist into `server/public`), `start`, `test`, `type-check`, `check` / `check:fix`.

## `packages/shared/src/index.ts`

The wire contract between browser and server. `Project`, `SessionInfo`, `TranscriptItem` (`user` | `update` | `turn_end` | `error`), `PermissionRequest`, and the two websocket unions: `ClientMessage` (`{ event, data }` — `subscribe`, `prompt`, `cancel`, `permission`) and `ServerMessage` (`{ type, … }` — `session`, `transcript`, `item`, `permission_request`, `permission_resolved`, `error`). Re-exports ACP's `SessionUpdate`, `ToolCallUpdate`, `PermissionOption`, `StopReason` so the web never imports the SDK's schema directly.

## `packages/server/src` tree

```
src/
├─ main.ts                          # Bootstrap: NestFactory, WsAdapter, shutdown hooks, prints token URL, opens browser
├─ app/app.module.ts                # Wires modules, ServeStatic for the SPA, global ZodValidationPipe, AuthMiddleware on '*' except api/ping
├─ controllers/                     # Thin HTTP + websocket layer, one module per resource (XControllerModule)
│  ├─ agents/                       # GET  api/agents
│  ├─ projects/                     # GET/POST api/projects, DELETE api/projects/:id (+ zod DTO)
│  ├─ sessions/                     # GET/POST api/sessions, POST api/sessions/import, DELETE api/sessions/:id
│  ├─ websocket/sessions.gateway.ts # @WebSocketGateway({ path: '/ws' }); cookie check on connect; subscribe/prompt/cancel/permission
│  └─ ping/                         # GET api/ping — the only unauthenticated route
├─ features/                        # Behaviour lives here (XModule); never imports controllers
│  ├─ agents/
│  │  ├─ agent.types.ts             # AgentAdapter, AgentEvents, AgentCapabilities, AgentSessionSummary, AcpAgentSpec
│  │  ├─ acp-agent.ts               # Generic ACP-over-stdio adapter: spawn, JSON-RPC via SDK, capabilities from initialize
│  │  └─ agent-registry.service.ts  # Known agent specs; starts one adapter process per agent on first use
│  ├─ projects/project-store.service.ts   # Registered directories → projects.json
│  └─ sessions/
│     ├─ session-store.service.ts   # Session index → sessions.json (everything but live state)
│     └─ session-manager.service.ts # Session lifecycle, transcripts, permission plumbing, fan-out, lazy re-attach
├─ infrastructure/
│  ├─ config/options.ts             # CLI flags/env → AppOptions (APP_OPTIONS token); app-options.module.ts
│  └─ token/token.service.ts        # Shared-secret token, CONFIG_DIR, cookie verification; token.module.ts (global)
└─ middleware/auth.middleware.ts    # ?token= → cookie + redirect; cookie check; 401/403
test/
├─ vitest-setup.ts                  # Points JOHNNY_CONFIG_DIR at a fresh temp dir
└─ fixtures/fake-acp-agent.mjs      # Scripted ACP agent (echo / ask / hang / exit) with file-backed history for list/load
```

`nest build` emits `dist/` (`bin: dist/main.js`); `public/` is the copied web build. `dist/` and `public/` are gitignored.

## How a prompt flows

1. Browser sends `{ event: 'prompt', data: { sessionId, text } }` on `/ws`.
2. `SessionsGateway.prompt` → `SessionManagerService.prompt`: marks the session busy, appends a `user` item, ensures the session is attached to the agent (see below), calls `adapter.prompt`.
3. `AcpAgent` sends `session/prompt`; the agent streams `session/update` notifications → `AgentEvents.update` → `onUpdate` appends `update` items and emits `item` messages to that session's subscribers.
4. A `session/request_permission` request from the agent becomes a `PermissionRequest` held on the session (`pending`) and a `permission_request` message; the browser's `{ event: 'permission' }` resolves it and the adapter answers the agent.
5. The prompt resolves with a `StopReason` → `turn_end` item, busy cleared, agent title adopted if it has one.

## Persistence and resume

Johnny owns only an index: `~/.config/johnny/{token,projects.json,sessions.json}` (`JOHNNY_CONFIG_DIR` overrides). Transcripts stay with the agent. On startup `SessionManagerService` hydrates sessions from the store as **not attached**; the first `subscribe`/`prompt` calls `ensureAttached`, which uses ACP `session/load` (replays history through the normal update path with `replaying` set, so it is delivered as one `transcript` message) or `session/resume` when history is already in memory. `importFromAgent` uses `session/list` for a project directory to adopt sessions started outside Johnny (`origin: 'agent'`). Agent disconnects mark sessions unattached again.

## `packages/web/src` tree

```
src/
├─ main.tsx                 # createRoot
├─ app.tsx                  # All state: agents, projects, sessions, active transcript, pending permission; REST via api(); ws via useSocket
├─ index.css                # Tailwind 4 + shadcn-style tokens, .prose-chat markdown styles
├─ lib/ws.ts                # Reconnecting singleton WebSocket (queues sends until open); useSocket, useSocketStatus
├─ lib/utils.ts             # cn()
├─ components/
│  ├─ sidebar.tsx           # Projects (collapsible, localStorage) → sessions; new/import/remove; add project
│  ├─ transcript.tsx        # Folds TranscriptItems into blocks: merged text, thoughts, grouped tool calls, errors
│  ├─ composer.tsx          # Textarea; Enter sends, Shift+Enter newline; cancel while busy
│  ├─ permission-bar.tsx    # Pending permission with its options
│  └─ ui/button.tsx         # shadcn-style button (lint-ignored like shadcn output)
└─ test/setup.ts            # jest-dom matchers, scrollIntoView stub
```

Dev: Vite on `56470` proxies `/api` and `/ws` to the server on `56469`. Auth is a cookie set by visiting `/?token=…` once.

## Testing

- **Server** (`*.spec.ts`, co-located): services built directly with fakes; `acp-agent.spec.ts` spawns the fake agent for real; `sessions.gateway.spec.ts` boots `AppModule` with only `AgentRegistryService` overridden and drives HTTP (supertest) + websocket (`ws`).
- **Web** (`*.test.tsx`, co-located): jsdom + Testing Library + `userEvent`; `ws.test.ts` swaps in a fake `WebSocket`.
- `npm test` at the root runs both. Policy (focused, real flows over mocks) is in `AGENTS.md`.

## Canonical examples

- **New REST resource:** `controllers/projects/*` (controller + zod DTO + `XControllerModule`) over `features/projects/project-store.service.ts` (+ `XModule`).
- **Talking to the agent:** `features/agents/acp-agent.ts` — every ACP method goes through `this.agent.request(methods.agent.…)`; gate new ones on `capabilities`.
- **New websocket event:** add to `ClientMessage` in shared, handle with `@SubscribeMessage` in `sessions.gateway.ts`, send from `app.tsx` via `socket.send`.
- **New transcript rendering:** extend `buildBlocks` in `components/transcript.tsx`.

## Start here if new

1. `packages/shared/src/index.ts` — the contract
2. `features/sessions/session-manager.service.ts` — where behaviour lives
3. `features/agents/acp-agent.ts` — the agent boundary
4. `controllers/websocket/sessions.gateway.ts` + `web/src/app.tsx` — the two ends of the socket
5. `AGENTS.md` — rules you must follow
