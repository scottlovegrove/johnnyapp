function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

/**
 * The login page is served before the SPA is allowed through, so it is a
 * self-contained document styled to match the app.
 */
export function renderLoginPage(next: string, error: string | null): string {
    return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Johnny — sign in</title>
<style>
  :root { color-scheme: dark; --bg: oklch(0.141 0.005 285.823); --fg: oklch(0.985 0 0); --muted: oklch(0.705 0.015 286.067); --card: oklch(0.21 0.006 285.885); --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --primary: oklch(0.92 0.004 286.32); --primary-fg: oklch(0.21 0.006 285.885); --danger: oklch(0.704 0.191 22.216); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  form { width: min(360px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  p { margin: 0 0 16px; color: var(--muted); }
  label { display: block; font-weight: 500; margin-bottom: 6px; }
  input { width: 100%; height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--input); background: transparent; color: inherit; font: inherit; }
  input:focus { outline: 2px solid var(--muted); outline-offset: 1px; }
  button { margin-top: 14px; width: 100%; height: 36px; border: 0; border-radius: 8px; background: var(--primary); color: var(--primary-fg); font: inherit; font-weight: 500; cursor: pointer; }
  .error { margin: 0 0 12px; color: var(--danger); }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Johnny</h1>
  <p>Enter the access token to continue.</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <label for="token">Access token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Sign in</button>
</form>
</body>
</html>`
}
