import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const CONFIG_DIR = process.env.JOHNNY_CONFIG_DIR ?? join(homedir(), ".config", "johnny");
const TOKEN_FILE = join(CONFIG_DIR, "token");
const COOKIE = "johnny_token";

/** Load the shared-secret token, generating one on first run. */
export function loadToken(): string {
  if (process.env.JOHNNY_TOKEN) return process.env.JOHNNY_TOKEN;
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, "utf8").trim();
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString("base64url");
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Every request must carry the token, either as a `?token=` query param (which
 * is then exchanged for a cookie and redirected away) or as the cookie itself.
 * Anyone who can reach this server can run shell commands via the agent, so
 * there is no unauthenticated surface beyond the health check.
 */
export function requireToken(token: string): MiddlewareHandler {
  return async (c, next) => {
    const fromQuery = c.req.query("token");
    if (fromQuery !== undefined) {
      if (!safeEqual(fromQuery, token)) return c.text("Forbidden", 403);
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/" });
      const url = new URL(c.req.url);
      url.searchParams.delete("token");
      return c.redirect(url.pathname + url.search);
    }
    const fromCookie = getCookie(c, COOKIE);
    if (fromCookie && safeEqual(fromCookie, token)) return next();
    return c.text("Unauthorised. Open the URL printed when Johnny started.", 401);
  };
}
