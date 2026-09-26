# Johnny

A self-hosted web chat that drives the AI coding agents you already have installed. Runs as one local Node process; the browser talks to it, it talks to the agent.

Agents are integrated through the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), so anything that speaks ACP over stdio can be plugged in. Claude Code is the first, via the bundled `@zed-industries/claude-code-acp` adapter, which uses your existing Claude Code login.

## Run

```sh
npm install
npm run build
npm start            # http://127.0.0.1:56469/?token=…
```

On first start a token is generated and stored in `~/.config/johnny/token`. The printed URL includes it and sets a cookie; every request without that cookie is rejected. Anyone who can reach the server can run shell commands on your machine through the agent, so keep the token private.

Flags: `--port 56469`, `--host 127.0.0.1` (pass `0.0.0.0` to expose on your network — put it behind a reverse proxy with websocket support), `--no-open`. Env: `PORT`, `HOST`, `JOHNNY_TOKEN`, `JOHNNY_CONFIG_DIR`.

## Develop

```sh
npm run dev          # server on :56469 (nest start --watch) + Vite on :56470 with /api and /ws proxied
```

Open `http://localhost:56470/?token=<token>` once so the cookie is set (the Vite proxy forwards it). Set `JOHNNY_DEV=1` to stop the server opening a browser tab.

## Tooling

Formatting and linting use [oxfmt](https://oxc.rs/docs/guide/usage/formatter) and [oxlint](https://oxc.rs/docs/guide/usage/linter):

```sh
npm run check        # oxfmt --check && oxlint .
npm run check:fix    # format and auto-fix
npm run type-check
```

A husky pre-commit hook runs `type-check` and `check:fix` against the staged files. CI (`.github/workflows/ci.yml`) runs format, lint, type-check and build on every push to `main` and every pull request.

Dependencies are pinned to exact versions (`save-exact=true` in `.npmrc`) and kept current by Renovate (`renovate.json`), which groups related packages and automerges minor/patch bumps once CI passes.

## Server layout

`packages/server/src` follows the same layering as the automations backend:

```
main.ts             bootstrap (Nest factory, ws adapter, shutdown hooks)
app/                AppModule: wires modules, global ZodValidationPipe, auth middleware
controllers/        thin HTTP controllers + the websocket gateway, one module per resource
features/           services holding the behaviour (agents, projects, sessions)
infrastructure/     cross-cutting plumbing (options, token)
middleware/         express middleware (auth)
```

Controllers depend on features; features never import controllers. Request bodies are validated with `nestjs-zod` DTOs.

## Layout

```
packages/
  shared/   websocket message types shared by server and web
  server/   NestJS app: controllers (HTTP + websocket gateway), features (services), infrastructure; serves the built SPA
  web/      React SPA (Vite, Tailwind, shadcn-style components)
```

`packages/server` is the publishable package (`johnny` bin). `npm run build` copies the web build into `packages/server/public` so a single package ships both halves.
