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
npm run dev          # server on :56469 (tsx watch) + Vite on :5173 with /api and /ws proxied
```

Open `http://localhost:5173/?token=<token>` once so the cookie is set (the Vite proxy forwards it). Set `JOHNNY_DEV=1` to stop the server opening a browser tab.

## Layout

```
packages/
  shared/   websocket message types shared by server and web
  server/   Hono HTTP + websocket server, ACP client, session manager, serves the built SPA
  web/      React SPA (Vite, Tailwind, shadcn-style components)
```

`packages/server` is the publishable package (`johnny` bin). `npm run build` copies the web build into `packages/server/public` so a single package ships both halves.
