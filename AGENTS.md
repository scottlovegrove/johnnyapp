# AGENTS

Guidance for anyone (human or agent) working in this repository.

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

## Layout

```
packages/
  shared/   websocket message types shared by server and web
  server/   NestJS app (publishable as `johnny`); serves the built SPA from ./public
  web/      React SPA (Vite, Tailwind v4, shadcn-style components)
```

See `README.md` for how to run and develop.
