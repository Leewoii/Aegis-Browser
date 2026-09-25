# Aegis Feedback Worker

Receives **Report a problem / Request a feature** submissions from the Dev Console
and gives you a password-protected triage dashboard to decide what to work on.

Live: `https://aegis-feedback.leeroi-c25.workers.dev`

## What it does

- `POST /api/feedback` — **open**, the app sends `{ kind, title, body, logs, stats, diagnostics, images(base64) }`
- `GET /api/feedback` — 🔒 list summaries (filter `?kind=bug&status=new&q=...`), needs password
- `GET /api/feedback/:id` — 🔒 full record with logs + base64 pictures, needs password
- `PATCH /api/feedback/:id` — 🔒 set `status` (`new` → `in-progress` → `done` / `rejected`) + `adminNote`
- `DELETE /api/feedback/:id` — 🔒 remove, needs password
- `GET /` — 🔒 dashboard: password gate, then see everything, open one item, read logs/pictures/stats, mark what you're working on
- `GET /health` — open, `{ok:true}` for uptime checks

🔒 = requires login when the secret is set.
POST stays open on purpose: the app submits without embedding your password
(anyone who extracts an embedded secret could read everything — this way the
password only ever lives in your head + your dashboard browser's session cookie).

## How the lock actually works (not bypassable via Inspect Element)

- Strangers who open `/` receive **only a login page** — the triage UI and all
  report data are never sent until the server validates the password.
- On correct password, `POST /api/login` sets an `HttpOnly` session cookie
  (`aegis_sess`, 30-day expiry, `Secure` on HTTPS). JavaScript can't read it,
  so XSS/devtools can't steal it — and deleting DOM nodes reveals nothing
  because every `/api/*` read re-checks the session server-side (401 otherwise).
- Login is throttled: 10 wrong tries per IP per 5 min (429 after that).
  Submissions are throttled too: 20 per IP per hour (anti-spam).
- 🔒 Log out button destroys the server-side session immediately.
- API/manual access still works with `Authorization: Bearer <ADMIN_TOKEN>`.

## Password setup (do this once)

1. `cd workers/feedback-worker && npm install`
2. `npx wrangler login`
3. `npx wrangler secret put ADMIN_TOKEN` → type your password (stored encrypted by Cloudflare, never in code)
4. `npx wrangler deploy`
5. Open `https://aegis-feedback.leeroi-c25.workers.dev/` → enter the password → it stays remembered in that browser (🔒 button locks it again)

Without the secret set, the dashboard/API are open — fine for local testing, not for production.

## KV storage (do this once)

1. `npx wrangler kv:namespace create FEEDBACK_KV` (and optionally `--preview`)
2. Paste the ids into `wrangler.toml` under `[[kv_namespaces]]` (uncomment block)
3. `npx wrangler deploy`

Without KV bound, the Worker still runs with in-memory storage (data lost on restart) —
fine for testing, not for production.

## Triage flow (your side)

1. Open `https://aegis-feedback.leeroi-c25.workers.dev/` in any browser, unlock with your password
2. Filter by Bugs / Features / status / search
3. Click an item → read description, attached log lines, stats, diagnostics, base64 pictures
4. Set status to `in-progress` when you start, add an admin note, `done` when shipped
