#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import open from "open";
import type { ClientMessage, ServerMessage } from "@johnny/shared";
import { loadToken, requireToken } from "./auth.js";
import { SessionManager, errorMessage } from "./sessions.js";

const { values: flags } = parseArgs({
  options: {
    port: { type: "string", short: "p", default: process.env.PORT ?? "56469" },
    host: { type: "string", default: process.env.HOST ?? "127.0.0.1" },
    "no-open": { type: "boolean", default: false },
  },
});

const port = Number(flags.port);
const host = flags.host!;
const token = loadToken();
const sessions = new SessionManager();

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("*", requireToken(token));

app.get("/api/agents", (c) => c.json(sessions.agents.list()));
app.get("/api/sessions", (c) => c.json(sessions.list()));
app.post("/api/sessions", async (c) => {
  const body = (await c.req.json()) as { agentId?: string; cwd?: string };
  if (!body.agentId || !body.cwd) return c.json({ error: "agentId and cwd are required" }, 400);
  if (!existsSync(body.cwd)) return c.json({ error: `Directory not found: ${body.cwd}` }, 400);
  try {
    return c.json(await sessions.create(body.agentId, body.cwd), 201);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 500);
  }
});

app.get(
  "/ws",
  upgradeWebSocket(() => {
    const unsubscribers: Array<() => void> = [];
    let send: (msg: ServerMessage) => void = () => {};

    return {
      onOpen(_evt, ws) {
        send = (msg) => ws.send(JSON.stringify(msg));
        unsubscribers.push(sessions.subscribeAll(send));
      },
      async onMessage(evt) {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(evt.data)) as ClientMessage;
        } catch {
          return send({ type: "error", message: "Malformed message" });
        }
        try {
          switch (msg.type) {
            case "subscribe":
              unsubscribers.push(sessions.subscribe(msg.sessionId, send));
              break;
            case "prompt":
              void sessions.prompt(msg.sessionId, msg.text);
              break;
            case "cancel":
              await sessions.cancel(msg.sessionId);
              break;
            case "permission":
              if (!sessions.resolvePermission(msg.requestId, msg.optionId)) {
                send({ type: "error", message: "Permission request no longer pending" });
              }
              break;
          }
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        }
      },
      onClose() {
        for (const off of unsubscribers) off();
      },
    };
  }),
);

// Built SPA lives in ./public next to dist/ once packaged; fall back to the
// sibling web package's build output during development.
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = [join(here, "..", "public"), join(here, "..", "..", "web", "dist")].find(existsSync);
if (publicDir) {
  const root = publicDir.startsWith(process.cwd()) ? publicDir.slice(process.cwd().length + 1) : publicDir;
  app.use("*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
} else {
  app.get("*", (c) => c.text("Web UI not built. Run `npm run build` or use the Vite dev server.", 503));
}

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const url = `http://${info.address === "0.0.0.0" || info.address === "::" ? "localhost" : info.address}:${info.port}/?token=${token}`;
  console.log(`\nJohnny listening on ${url}\n`);
  if (!flags["no-open"] && !process.env.JOHNNY_DEV) void open(url);
});
injectWebSocket(server);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    sessions.shutdown();
    server.close();
    process.exit(0);
  });
}
