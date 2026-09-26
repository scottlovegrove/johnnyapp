# AGENTS

Guidance for anyone (human or agent) working in this repository. This file says _how to change things_; `CODEBASE.md` says _what is where_ — read it first instead of exploring, and update it when the structure shifts.

## Reference codebase

`~/automations` (the Doist Todoist Automations monorepo) is the gold standard for how this project is set up. When a stylistic or structural choice is not covered here, look at how automations does it and copy that, rather than inventing something. This covers naming, file layout, NestJS patterns, tooling versions, dependency handling, CI and anything else that is a matter of convention.

## Conventions

- **File names are kebab-case** everywhere: `permission-bar.tsx`, `session-manager.service.ts`, `agent-registry.service.ts`. Never PascalCase or camelCase file names, including React components.
- **NestJS layering** in `packages/server/src`: `controllers/` (thin HTTP controllers and websocket gateways, one module per resource, named `XControllerModule`) → `features/` (services holding the behaviour, named `XModule`) → `infrastructure/` (cross-cutting plumbing) and `middleware/`. Controllers depend on features; features never import controllers.
- **Dependency injection** assigns constructor parameters to explicit `private readonly` fields rather than using parameter properties.
- **Request validation** uses `nestjs-zod` DTOs (`createZodDto`) with the global `ZodValidationPipe`. Use the top-level zod helpers (`z.email()`, `z.url()`) rather than chained `z.string().email()`.
- **Formatting and linting** are `oxfmt` and `oxlint`, configured in `.oxfmtrc.json` and `.oxlintrc.json`. Run `npm run check:fix` before committing; the pre-commit hook does the same.
- **TypeScript**: strict, `noUncheckedIndexedAccess`, no non-null assertions, no `any`, no namespace imports (`import * as`).
- **Dependencies** are pinned to exact versions (`save-exact=true`). Renovate keeps them current. Use `npm`, not pnpm or yarn.
- **Node** ≥ 24.15 (see `.node-version`).
- **Spelling** in prose (docs, comments, commit messages, UI copy) is British English.
- **Code comments** describe what the code does and why in its own terms. Never reference pull requests, rollout stages or "follow-ups" in code or docstrings.

## Testing

Tests are the safety net for code that is written by agents and rarely read line by line, so they matter more here than usual. They are also deliberately focused:

- Test the **core behaviour** of each part: the session lifecycle, the agent adapter over a real stdio connection, auth, the websocket contract, and the UI components that render the transcript and collect input. A representative edge case or two per area is fine; do not enumerate every permutation or test trivial glue.
- Prefer one test that drives a real flow (Nest app + websocket, real fake-agent process) over many that assert on mocks.
- **Server**: `vitest` with `*.spec.ts` next to the code under test. Services are constructed directly with fakes; the gateway is tested through the real `AppModule` with only `AgentRegistryService` overridden. `test/fixtures/fake-acp-agent.mjs` is a scripted ACP agent for exercising `AcpAgent`.
- **Web**: `vitest` + jsdom + Testing Library, `*.test.tsx` next to the component. Query by role and visible text, drive with `userEvent`.
- Run everything with `npm test` from the root. CI runs it on every pull request and push to `main`.

## Layout

```
packages/
  shared/   websocket message types shared by server and web
  server/   NestJS app (publishable as `johnny`); serves the built SPA from ./public
  web/      React SPA (Vite, Tailwind v4, shadcn-style components)
```

Runtime state lives in `~/.config/johnny/` (`JOHNNY_CONFIG_DIR`): `token`, `projects.json`, `sessions.json`. Transcripts are not stored there; the agent is the source of truth and replays them over ACP.

See `README.md` for how to run and develop.
