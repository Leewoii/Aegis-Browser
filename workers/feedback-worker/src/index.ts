/**
 * Aegis Feedback Worker
 * Stores bug reports + feature requests from the Dev Console modal,
 * and serves a triage dashboard at GET / where you can pick what to work on.
 *
 * Storage: KV (FEEDBACK_KV) if bound, otherwise in-memory fallback (dev only).
 * Endpoints:
 *   POST   /api/feedback        create {kind,title,body,logs,stats,diagnostics,images}
 *   GET    /api/feedback        list summaries (?kind=bug|feature&status=new|...)
 *   GET    /api/feedback/:id    full record (with base64 images + logs)
 *   PATCH  /api/feedback/:id    {status, adminNote} — needs ADMIN_TOKEN if set
 *   DELETE /api/feedback/:id    remove — needs ADMIN_TOKEN if set
 *   GET    /                    dashboard UI
 *   GET    /health              {ok:true}
 */

// Minimal KV shape for editors/typechecks (wrangler provides the real binding at deploy).
interface KVNamespace {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor: string;
  }>;
}

export interface Env {
  FEEDBACK_KV?: KVNamespace;
  ADMIN_TOKEN?: string;
}

type FeedbackKind = "bug" | "feature";
type FeedbackStatus = "new" | "in-progress" | "done" | "rejected";

interface FeedbackRecord {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  status: FeedbackStatus;
  adminNote?: string;
  appVersion?: string;
  platform?: string;
  logIds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diagnostics?: any;
  images?: { name: string; mime: string; size: number; dataUrl: string }[];
}

const PREFIX = "fb:";
const MAX_BODY_BYTES = 9 * 1024 * 1024;

// In-memory fallback when KV is not bound (wrangler dev without --kv)
const mem = new Map<string, FeedbackRecord>();

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function bad(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

const SESS_PREFIX = "sess:";
const SESS_COOKIE = "aegis_sess";
const SESS_TTL_SEC = 30 * 24 * 3600; // 30 days

// In-memory session fallback when KV is not bound (dev only)
const memSess = new Map<string, number>();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function sessionValid(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  if (env.FEEDBACK_KV) {
    return (await env.FEEDBACK_KV.get<number>(SESS_PREFIX + token, "json")) != null;
  }
  return memSess.has(token);
}

async function sessionCreate(env: Env): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  if (env.FEEDBACK_KV) {
    await env.FEEDBACK_KV.put(SESS_PREFIX + token, JSON.stringify(Date.now()), {
      expirationTtl: SESS_TTL_SEC,
    });
  } else {
    memSess.set(token, Date.now());
  }
  return token;
}

async function sessionDestroy(env: Env, token: string): Promise<void> {
  if (!token) return;
  if (env.FEEDBACK_KV) {
    await env.FEEDBACK_KV.delete(SESS_PREFIX + token);
  } else {
    memSess.delete(token);
  }
}

function sessionCookie(token: string, https: boolean): string {
  let c = `${SESS_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESS_TTL_SEC}`;
  if (https) c += "; Secure";
  return c;
}

function clearSessionCookie(https: boolean): string {
  let c = `${SESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  if (https) c += "; Secure";
  return c;
}

/** True when the request may read/manage reports: open mode, valid Bearer token, or valid session cookie. */
async function isAuthed(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return true; // no password configured → open (dev)
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && safeEqual(auth.slice(7), env.ADMIN_TOKEN)) return true;
  const token = getCookies(request)[SESS_COOKIE] || "";
  if (token && (await sessionValid(env, token))) return true;
  return false;
}

function requireAdmin(request: Request, env: Env, authed: boolean): Response | null {
  if (!env.ADMIN_TOKEN) return null;
  if (authed) return null;
  return json({ error: "Unauthorized." }, 401);
}

/** Generic KV-backed throttle. Returns false when key exceeded limit within windowSec. */
async function throttle(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!env.FEEDBACK_KV) return true; // dev mode: no throttle
  const full = "rl:" + key;
  const rec = await env.FEEDBACK_KV.get<{ count: number }>(full, "json");
  if (rec && rec.count >= limit) return false;
  return true;
}

async function throttleHit(env: Env, key: string, windowSec: number): Promise<void> {
  if (!env.FEEDBACK_KV) return;
  const full = "rl:" + key;
  const rec = await env.FEEDBACK_KV.get<{ count: number }>(full, "json");
  const next = (rec?.count ?? 0) + 1;
  await env.FEEDBACK_KV.put(full, JSON.stringify({ count: next }), { expirationTtl: windowSec });
}

async function throttleClear(env: Env, key: string): Promise<void> {
  if (!env.FEEDBACK_KV) return;
  await env.FEEDBACK_KV.delete("rl:" + key);
}

async function kvGet(env: Env, id: string): Promise<FeedbackRecord | null> {
  if (env.FEEDBACK_KV) {
    return (await env.FEEDBACK_KV.get<FeedbackRecord>(PREFIX + id, "json")) ?? null;
  }
  return mem.get(id) ?? null;
}

async function kvPut(env: Env, rec: FeedbackRecord): Promise<void> {
  if (env.FEEDBACK_KV) {
    await env.FEEDBACK_KV.put(PREFIX + rec.id, JSON.stringify(rec));
  } else {
    mem.set(rec.id, rec);
  }
}

async function kvDelete(env: Env, id: string): Promise<void> {
  if (env.FEEDBACK_KV) {
    await env.FEEDBACK_KV.delete(PREFIX + id);
  } else {
    mem.delete(id);
  }
}

async function kvListAll(env: Env): Promise<FeedbackRecord[]> {
  if (env.FEEDBACK_KV) {
    const out: FeedbackRecord[] = [];
    let cursor: string | undefined = undefined;
    for (let i = 0; i < 20; i++) {
      const page = await env.FEEDBACK_KV.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const key of page.keys) {
        const rec = await env.FEEDBACK_KV.get<FeedbackRecord>(key.name, "json");
        if (rec) out.push(rec);
      }
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    return out;
  }
  return [...mem.values()];
}

function summary(rec: FeedbackRecord): Record<string, unknown> {
  return {
    id: rec.id,
    kind: rec.kind,
    title: rec.title,
    status: rec.status,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    appVersion: rec.appVersion,
    platform: rec.platform,
    logCount: rec.logs?.length ?? rec.logIds?.length ?? 0,
    imageCount: rec.images?.length ?? 0,
    hasImages: (rec.images?.length ?? 0) > 0,
    imagesMeta: (rec.images ?? []).map((i) => ({ name: i.name, mime: i.mime, size: i.size })),
    bodyPreview: String(rec.body || "").slice(0, 220),
  };
}

function validateCreate(payload: Partial<FeedbackRecord>): string | null {
  if (payload.kind !== "bug" && payload.kind !== "feature") return "kind must be 'bug' or 'feature'.";
  if (!payload.title || payload.title.trim().length < 3) return "title is required (min 3 chars).";
  if (payload.title.length > 140) return "title exceeds 140 chars.";
  if (!payload.body || payload.body.trim().length < 5) return "body is required (min 5 chars).";
  if (payload.body.length > 8000) return "body exceeds 8000 chars.";
  if (payload.images && payload.images.length > 4) return "max 4 images.";
  for (const img of payload.images ?? []) {
    if (!img.dataUrl?.startsWith("data:image/")) return `image "${img.name}" must be a data:image/* data URL (base64).`;
    if (img.dataUrl.length > 7 * 1024 * 1024) return `image "${img.name}" is too large.`;
  }
  if (payload.logs && payload.logs.length > 200) return "max 200 attached logs.";
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (pathname === "/health") return json({ ok: true });

    const authed = await isAuthed(request, env);
    const isHttps = new URL(request.url).protocol === "https:";

    if (pathname === "/" || pathname === "/index.html") {
      // Strangers never receive the dashboard code at all — only a login
      // page. Deleting DOM nodes can't reveal what was never sent.
      const html = !env.ADMIN_TOKEN || authed ? dashboardHtml() : loginHtml();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() },
      });
    }

    if (pathname === "/api/login" && request.method === "POST") {
      if (!env.ADMIN_TOKEN) return json({ open: true });
      const ip = clientIp(request);
      if (!(await throttle(env, "login:" + ip, 10, 300))) {
        return bad("Too many attempts. Try again in a few minutes.", 429);
      }
      let password = "";
      try {
        password = String((await request.json())?.password ?? "");
      } catch {
        return bad("Invalid JSON.");
      }
      if (!safeEqual(password, env.ADMIN_TOKEN)) {
        await throttleHit(env, "login:" + ip, 300);
        // Generic message: don't reveal whether a password is even set.
        await new Promise((r) => setTimeout(r, 400));
        return bad("Wrong password.", 401);
      }
      await throttleClear(env, "login:" + ip);
      const token = await sessionCreate(env);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": sessionCookie(token, isHttps),
          ...corsHeaders(),
        },
      });
    }

    if (pathname === "/api/logout" && request.method === "POST") {
      const token = getCookies(request)[SESS_COOKIE] || "";
      await sessionDestroy(env, token);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": clearSessionCookie(isHttps),
          ...corsHeaders(),
        },
      });
    }

    if (pathname === "/api/feedback" && request.method === "POST") {
      // Anti-spam throttle (per IP). Reports themselves stay open so the
      // app can submit without embedding your password.
      if (!(await throttle(env, "submit:" + clientIp(request), 20, 3600))) {
        return bad("Too many submissions. Try again later.", 429);
      }
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return bad("Payload too large.", 413);
      let payload: Partial<FeedbackRecord>;
      try {
        payload = JSON.parse(raw);
      } catch {
        return bad("Invalid JSON.");
      }
      const err = validateCreate(payload);
      if (err) return bad(err);
      const now = new Date().toISOString();
      const rec: FeedbackRecord = {
        id: crypto.randomUUID(),
        kind: payload.kind as FeedbackKind,
        title: payload.title!.trim(),
        body: payload.body!.trim(),
        createdAt: payload.createdAt || now,
        updatedAt: now,
        status: "new",
        appVersion: typeof payload.appVersion === "string" ? payload.appVersion.slice(0, 40) : undefined,
        platform: typeof payload.platform === "string" ? payload.platform.slice(0, 80) : undefined,
        logIds: Array.isArray(payload.logIds) ? payload.logIds.slice(0, 200).map(String) : undefined,
        logs: Array.isArray(payload.logs) ? payload.logs.slice(0, 200) : undefined,
        stats: payload.stats ?? undefined,
        diagnostics: payload.diagnostics ?? undefined,
        images: Array.isArray(payload.images) ? payload.images.slice(0, 4) : undefined,
      };
      await kvPut(env, rec);
      return json(rec, 201);
    }

    if (pathname === "/api/feedback" && request.method === "GET") {
      // Reading reports requires the password (when ADMIN_TOKEN is set).
      // POST stays open so the app can submit without embedding the secret.
      const gate = requireAdmin(request, env, authed);
      if (gate) return gate;
      const kind = url.searchParams.get("kind");
      const status = url.searchParams.get("status");
      const q = (url.searchParams.get("q") || "").toLowerCase();
      let all = await kvListAll(env);
      all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (kind === "bug" || kind === "feature") all = all.filter((r) => r.kind === kind);
      if (status === "new" || status === "in-progress" || status === "done" || status === "rejected") {
        all = all.filter((r) => r.status === status);
      }
      if (q) {
        all = all.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.body.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q),
        );
      }
      return json({ count: all.length, items: all.map(summary) });
    }

    const detailMatch = pathname.match(/^\/api\/feedback\/([A-Za-z0-9-]+)$/);
    if (detailMatch) {
      const id = detailMatch[1];
      if (request.method === "GET") {
        const gate = requireAdmin(request, env, authed);
        if (gate) return gate;
        const rec = await kvGet(env, id);
        if (!rec) return bad("Not found.", 404);
        return json(rec);
      }
      if (request.method === "PATCH") {
        const gate = requireAdmin(request, env, authed);
        if (gate) return gate;
        const rec = await kvGet(env, id);
        if (!rec) return bad("Not found.", 404);
        let patch: { status?: FeedbackStatus; adminNote?: string };
        try {
          patch = await request.json();
        } catch {
          return bad("Invalid JSON.");
        }
        if (patch.status && !["new", "in-progress", "done", "rejected"].includes(patch.status)) {
          return bad("Invalid status.");
        }
        if (patch.status) rec.status = patch.status;
        if (typeof patch.adminNote === "string") rec.adminNote = patch.adminNote.slice(0, 4000);
        rec.updatedAt = new Date().toISOString();
        await kvPut(env, rec);
        return json(rec);
      }
      if (request.method === "DELETE") {
        const gate = requireAdmin(request, env, authed);
        if (gate) return gate;
        await kvDelete(env, id);
        return json({ ok: true });
      }
    }

    return bad("Not found.", 404);
  },
};

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aegis Feedback Triage</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0b0e16;color:#e5e9f2;display:flex;height:100vh}
aside{width:360px;min-width:300px;border-right:1px solid #222a3d;display:flex;flex-direction:column;background:#0e1320}
header{padding:14px 16px;border-bottom:1px solid #222a3d}header h1{margin:0;font-size:15px}header p{margin:2px 0 0;color:#8b94a9;font-size:12px}
.filters{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #222a3d}
.filters select,.filters input{background:#05070d;border:1px solid #2a3350;color:#e5e9f2;border-radius:7px;padding:6px 8px;font-size:12px}
.filters input{flex:1;min-width:120px}
#list{flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
.item{border:1px solid #242d47;border-radius:10px;padding:10px 12px;cursor:pointer;background:#121829}.item.active{border-color:#6e9bff;background:#16203a}
.item .row1{display:flex;gap:8px;align-items:center;font-size:11px}.item strong{display:block;margin-top:4px;font-size:13px}
.kind{font-weight:800;padding:1px 7px;border-radius:5px;font-size:10px}.kind.bug{background:rgba(244,63,94,.18);color:#fb7185}.kind.feature{background:rgba(52,211,153,.18);color:#34d399}
.st{margin-left:auto;font-weight:700;font-size:10px;padding:1px 7px;border-radius:99px;background:#222c48;color:#aeb9d4}.st.new{background:rgba(110,155,255,.18);color:#b5ceff}.st.in-progress{background:rgba(251,191,36,.18);color:#fbbf24}.st.done{background:rgba(52,211,153,.18);color:#34d399}.st.rejected{background:rgba(244,63,94,.18);color:#fb7185}
.prev{color:#8b94a9;font-size:12px;margin-top:4px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
main{flex:1;overflow:auto;padding:24px;max-width:900px}main img{max-width:100%;border-radius:8px;border:1px solid #2a3350}
.meta{color:#8b94a9;font-size:12px}.card{border:1px solid #242d47;border-radius:12px;padding:16px;background:#101728;margin-top:14px}
pre{background:#05070d;border:1px solid #242d47;border-radius:8px;padding:12px;overflow:auto;font-size:11.5px;max-height:320px}
.log{border-left:3px solid #60a5fa;background:#101728;border-radius:6px;padding:8px 10px;margin:6px 0;font-size:12px}.log.error{border-color:#f43f5e}.log.warn{border-color:#fbbf24}.log.success{border-color:#34d399}
.triage{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.triage button,.triage select{background:#1a2340;color:#e5e9f2;border:1px solid #33406a;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer}
.triage textarea{width:100%;background:#05070d;border:1px solid #2a3350;color:#e5e9f2;border-radius:8px;padding:8px;font-size:12px;margin-top:8px;min-height:64px}
.empty{color:#8b94a9;text-align:center;margin-top:80px}
.lockbtn{background:#1a2340;color:#e5e9f2;border:1px solid #33406a;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-left:8px}
</style></head><body>
<aside><header><h1>Aegis Feedback Triage<button class="lockbtn" id="lockBtn" title="Log out this browser">🔒 Log out</button></h1><p>Pick what to work on — bug reports + feature requests</p></header>
<div class="filters"><select id="fKind"><option value="">All kinds</option><option value="bug">Bugs</option><option value="feature">Features</option></select>
<select id="fStatus"><option value="">All status</option><option value="new">New</option><option value="in-progress">In progress</option><option value="done">Done</option><option value="rejected">Rejected</option></select>
<input id="fQ" placeholder="Search…"/></div><div id="list"></div></aside>
<main id="main"><div class="empty">Select an item on the left to see everything you need: description, logs, stats, pictures.</div></main>
<script>
let items=[],activeId=null;
async function load(){const k=fKind.value,s=fStatus.value,q=fQ.value;let r;try{r=await fetch('/api/feedback?'+new URLSearchParams({kind:k,status:s,q}));}catch(e){list.innerHTML='<div class="empty">Worker unreachable.</div>';return;}if(r.status===401){location.reload();return;}const j=await r.json();items=j.items||[];renderList();}
function renderList(){list.innerHTML=items.map(i=>'<div class="item'+(i.id===activeId?' active':'')+'" data-id="'+i.id+'"><div class="row1"><span class="kind '+i.kind+'">'+(i.kind==='bug'?'BUG':'FEATURE')+'</span><span class="meta">'+new Date(i.createdAt).toLocaleString()+'</span><span class="st '+i.status+'">'+i.status+'</span></div><strong>'+escapeHtml(i.title)+'</strong><span class="prev">'+escapeHtml(i.bodyPreview||'')+' &middot; '+(i.logCount||0)+' logs &middot; '+(i.imageCount||0)+' imgs</span></div>').join('')||'<div class="empty">No items.</div>';[...list.querySelectorAll('.item')].forEach(el=>el.onclick=()=>openDetail(el.dataset.id));}
async function openDetail(id){activeId=id;renderList();const r=await fetch('/api/feedback/'+id);if(r.status===401){location.reload();return;}const d=await r.json();main.innerHTML=detailHtml(d);wireTriage(d);}
function detailHtml(d){return '<div class="meta">'+d.id+' &middot; '+new Date(d.createdAt).toLocaleString()+' &middot; '+(d.appVersion||'')+' '+(d.platform||'')+'</div><h2 style="margin:6px 0">'+escapeHtml(d.title)+' <span class="kind '+d.kind+'">'+d.kind+'</span> <span class="st '+d.status+'">'+d.status+'</span></h2><div class="card"><h3>Description</h3><p style="white-space:pre-wrap">'+escapeHtml(d.body)+'</p></div>'
+(d.images&&d.images.length?'<div class="card"><h3>Pictures ('+d.images.length+')</h3>'+d.images.map(i=>'<p><b>'+escapeHtml(i.name)+'</b> <span class="meta">'+i.mime+' &middot; '+Math.round(i.size/1024)+'KB</span><br/><img src="'+i.dataUrl+'"/></p>').join('')+'</div>':'')
+(d.logs&&d.logs.length?'<div class="card"><h3>Attached logs ('+d.logs.length+')</h3>'+d.logs.map(l=>'<div class="log '+(l.level||'')+'"><b>['+(l.timeFormatted||'')+'] '+escapeHtml(l.title||'')+'</b><br/><span>'+escapeHtml(l.message||'')+'</span>'+(l.stack?'<pre>'+escapeHtml(l.stack)+'</pre>':'')+(l.sqlQuery?'<pre>'+escapeHtml(l.sqlQuery)+'</pre>':'')+'</div>').join('')+'</div>':'')
+(d.stats?'<div class="card"><h3>System stats</h3><pre>'+escapeHtml(JSON.stringify(d.stats,null,2))+'</pre></div>':'')
+(d.diagnostics?'<div class="card"><h3>Diagnostics snapshot</h3><pre>'+escapeHtml(JSON.stringify(d.diagnostics,null,2))+'</pre></div>':'')
+'<div class="card"><h3>Work on this</h3><div class="triage"><select id="tStatus"><option>new</option><option>in-progress</option><option>done</option><option>rejected</option></select><button data-act="save">Save status</button><button data-act="start">Start working → in-progress</button><button data-act="done">Mark done</button><button data-act="del" style="color:#fda4af">Delete</button></div><textarea id="tNote" placeholder="Admin note — what did you decide / fix?">'+escapeHtml(d.adminNote||'')+'</textarea><div class="meta" id="tMsg"></div></div>';
}
function wireTriage(d){tStatus.value=d.status;document.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act,d));}
async function act(a,d){const h={'Content-Type':'application/json'};tMsg.textContent='Saving…';
try{if(a==='del'){const r=await fetch('/api/feedback/'+d.id,{method:'DELETE',headers:h});if(r.status===401){location.reload();return;}if(!r.ok)throw new Error(await r.text());activeId=null;main.innerHTML='<div class="empty">Deleted.</div>';await load();return;}
let status=tStatus.value;if(a==='start')status='in-progress';if(a==='done')status='done';const r=await fetch('/api/feedback/'+d.id,{method:'PATCH',headers:h,body:JSON.stringify({status,adminNote:tNote.value})});if(r.status===401){location.reload();return;}const j=await r.json();if(!r.ok)throw new Error(j.error||r.statusText);tMsg.textContent='Saved: '+j.status;await load();await openDetail(d.id);}catch(e){tMsg.textContent='Error: '+e.message;}}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
lockBtn.onclick=async()=>{try{await fetch('/api/logout',{method:'POST'});}catch(e){}location.reload();};
fKind.onchange=load;fStatus.onchange=load;fQ.oninput=()=>{clearTimeout(window._t);window._t=setTimeout(load,250);};load();
</script></body></html>`;
}

/** What strangers get: a password form only. No dashboard markup, no report
 *  data, nothing to reveal via Inspect Element — the triage UI is never sent
 *  until the server sets a valid session cookie. */
function loginHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aegis Feedback — Private</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0b0e16;color:#e5e9f2;display:flex;align-items:center;justify-content:center;height:100vh}
.card{width:340px;border:1px solid #2a3350;border-radius:14px;background:#0e1320;padding:28px;text-align:center}
h2{margin:0 0 4px;font-size:16px}p{margin:0 0 16px;color:#8b94a9;font-size:12px}
input{width:100%;background:#05070d;border:1px solid #2a3350;color:#e5e9f2;border-radius:8px;padding:10px;font-size:13px;margin-bottom:10px}
button{width:100%;background:#6e9bff;border:0;color:#05060b;border-radius:8px;padding:10px;font-size:13px;font-weight:800;cursor:pointer}
button:disabled{opacity:.5}
.err{color:#fda4af;font-size:12px;min-height:18px;margin-top:8px}
</style></head><body>
<div class="card"><h2>🔒 Private triage</h2><p>This dashboard is password-protected.</p>
<input id="pass" type="password" placeholder="Password" autocomplete="current-password"/>
<button id="btn">Unlock</button><div class="err" id="err"></div></div>
<script>
async function go(){const p=pass.value;if(!p){err.textContent='Enter the password first.';return;}btn.disabled=true;err.textContent='';
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});
if(r.ok){location.reload();return;}err.textContent=(await r.json()).error||'Login failed.';}catch(e){err.textContent='Worker unreachable.';}btn.disabled=false;}
btn.onclick=go;pass.onkeydown=e=>{if(e.key==='Enter')go();};setTimeout(()=>pass.focus(),50);
</script></body></html>`;
}
