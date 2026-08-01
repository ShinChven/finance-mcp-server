// End-to-end smoke test against the dev server: session auth, PAT lifecycle,
// OAuth 2.1 PKCE flow, MCP tool calls, refresh rotation + reuse detection.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { serializeSigned } from "hono/utils/cookie";

const BASE = "http://localhost:5173";
const SECRET = "dev-secret-0123456789abcdef0123456789abcdef";
const pool = new pg.Pool({ connectionString: "postgres://mcp:mcp@localhost:5432/mcp" });

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (!ok) failures++;
}

// idempotency: remove artifacts from previous runs
await pool.query("delete from users where email='invitee@example.com'");
await pool.query("delete from oauth_clients where client_name='E2E Client'");
await pool.query("delete from access_tokens where name='e2e token'");

// --- mint a session for the seeded admin ---
const { rows: userRows } = await pool.query("select id, email from users where email='shinchven@gmail.com'");
check("admin user seeded", userRows.length === 1);
const userId = userRows[0].id;

const rawSession = randomBytes(32).toString("base64url");
await pool.query("insert into sessions (id, user_id, expires_at) values ($1,$2, now() + interval '7 days')", [
  sha256hex(rawSession),
  userId,
]);
const cookie = (await serializeSigned("sid", rawSession, SECRET, { path: "/" })).split(";")[0];
const authHeaders = { Cookie: cookie, Origin: BASE };

// --- /api/me ---
const me = await fetch(`${BASE}/api/me`, { headers: authHeaders }).then((r) => r.json());
check("GET /api/me", me.email === "shinchven@gmail.com" && me.role === "admin", JSON.stringify(me));

// --- CSRF: unsafe request without Origin is rejected ---
const noOrigin = await fetch(`${BASE}/api/tokens`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "x" }),
});
check("CSRF blocks missing Origin", noOrigin.status === 403);
const badOrigin = await fetch(`${BASE}/api/tokens`, {
  method: "POST",
  headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" },
  body: JSON.stringify({ name: "x" }),
});
check("CSRF blocks foreign Origin", badOrigin.status === 403);

// --- PAT lifecycle ---
const patRes = await fetch(`${BASE}/api/tokens`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "e2e token", expiresAt: null }),
});
const pat = await patRes.json();
check("create PAT", patRes.status === 201 && pat.token?.startsWith("mcp_"), JSON.stringify(pat));

async function mcpCall(token, name, args = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const whoami = await mcpCall(pat.token, "whoami");
check(
  "MCP whoami via PAT",
  whoami.status === 200 && whoami.text.includes("shinchven@gmail.com") && whoami.text.includes("personal access token"),
  whoami.text.slice(0, 300),
);
const echo = await mcpCall(pat.token, "echo", { text: "hello mcp" });
check("MCP echo via PAT", echo.text.includes("hello mcp"), echo.text.slice(0, 200));

// disabled PAT is rejected
await fetch(`${BASE}/api/tokens/${pat.item.id}`, {
  method: "PATCH",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ status: "disabled" }),
});
const disabledCall = await mcpCall(pat.token, "whoami");
check("disabled PAT rejected", disabledCall.status === 401, disabledCall.text);
// re-enable, then revoke → rejected
await fetch(`${BASE}/api/tokens/${pat.item.id}`, {
  method: "PATCH",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ status: "active" }),
});
const reenabled = await mcpCall(pat.token, "whoami");
check("re-enabled PAT works", reenabled.status === 200);
await fetch(`${BASE}/api/tokens/${pat.item.id}/revoke`, { method: "POST", headers: authHeaders });
const revokedCall = await mcpCall(pat.token, "whoami");
check("revoked PAT rejected", revokedCall.status === 401);

// bad token → 401 with WWW-Authenticate discovery pointer
const badBearer = await fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: "Bearer nope" } });
check(
  "401 includes resource metadata",
  badBearer.status === 401 && (badBearer.headers.get("www-authenticate") ?? "").includes("oauth-protected-resource"),
  badBearer.headers.get("www-authenticate") ?? "none",
);

// --- OAuth 2.1 PKCE flow ---
const reg = await fetch(`${BASE}/oauth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "E2E Client", redirect_uris: ["http://127.0.0.1:9999/callback"] }),
}).then((r) => r.json());
check("dynamic client registration", !!reg.client_id && reg.token_endpoint_auth_method === "none", JSON.stringify(reg));

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorizeUrl =
  `${BASE}/oauth/authorize?client_id=${reg.client_id}` +
  `&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}` +
  `&response_type=code&state=xyz123&code_challenge=${challenge}&code_challenge_method=S256&scope=mcp`;

// without session → redirect to /login
const anonAuthorize = await fetch(authorizeUrl, { redirect: "manual" });
check(
  "authorize w/o session redirects to login",
  anonAuthorize.status === 302 && (anonAuthorize.headers.get("location") ?? "").startsWith("/login?next="),
  String(anonAuthorize.status),
);

// with session → consent page
const consentRes = await fetch(authorizeUrl, { headers: { Cookie: cookie } });
const consentHtml = await consentRes.text();
check("consent page rendered", consentRes.status === 200 && consentHtml.includes("E2E Client"), consentHtml.slice(0, 200));

// approve
const form = new URLSearchParams({
  client_id: reg.client_id,
  redirect_uri: "http://127.0.0.1:9999/callback",
  response_type: "code",
  state: "xyz123",
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "mcp",
  decision: "approve",
});
const decision = await fetch(`${BASE}/oauth/authorize/decision`, {
  method: "POST",
  headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
  body: form,
  redirect: "manual",
});
const redirectLocation = decision.headers.get("location") ?? "";
const code = new URL(redirectLocation, BASE).searchParams.get("code");
check(
  "consent approve issues code",
  decision.status === 302 && !!code && redirectLocation.includes("state=xyz123"),
  redirectLocation,
);

// wrong verifier fails
const badExchange = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier",
    client_id: reg.client_id,
    redirect_uri: "http://127.0.0.1:9999/callback",
  }),
});
check("PKCE mismatch rejected", badExchange.status === 400, String(badExchange.status));

// correct exchange
const tokenRes = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: reg.client_id,
    redirect_uri: "http://127.0.0.1:9999/callback",
  }),
});
const tokens = await tokenRes.json();
check(
  "code exchange returns tokens",
  tokenRes.status === 200 && tokens.access_token?.startsWith("mcpo_") && tokens.refresh_token?.startsWith("mcpr_"),
  JSON.stringify(tokens).slice(0, 200),
);

const oauthWhoami = await mcpCall(tokens.access_token, "whoami");
check(
  "MCP whoami via OAuth token",
  oauthWhoami.status === 200 && oauthWhoami.text.includes("oauth 2.1"),
  oauthWhoami.text.slice(0, 300),
);

// refresh rotation
const refreshRes = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: reg.client_id,
  }),
});
const rotated = await refreshRes.json();
check("refresh rotation", refreshRes.status === 200 && !!rotated.access_token, JSON.stringify(rotated).slice(0, 150));

// reuse of the old refresh token → family revoked
const reuse = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: reg.client_id,
  }),
});
check("refresh reuse detected", reuse.status === 400);
const familyRevoked = await mcpCall(rotated.access_token, "whoami");
check("family revoked after reuse", familyRevoked.status === 401, familyRevoked.text);

// code replay: rejected (tokens from that code are already dead via reuse test above)
const replay = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: reg.client_id,
    redirect_uri: "http://127.0.0.1:9999/callback",
  }),
});
check("code replay rejected", replay.status === 400);

// second authorize skips consent (active grant, same scope) — re-approve grant first
const verifier2 = randomBytes(32).toString("base64url");
const challenge2 = createHash("sha256").update(verifier2).digest("base64url");
const auto = await fetch(
  `${BASE}/oauth/authorize?client_id=${reg.client_id}` +
    `&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}` +
    `&response_type=code&code_challenge=${challenge2}&code_challenge_method=S256&scope=mcp`,
  { headers: { Cookie: cookie }, redirect: "manual" },
);
check("repeat authorize skips consent", auto.status === 302 && (auto.headers.get("location") ?? "").includes("code="));

// grant revocation via dashboard API blocks tokens
const grants = await fetch(`${BASE}/api/clients?per_page=20`, { headers: authHeaders }).then((r) => r.json());
const grant = grants.items.find((g) => g.clientId === reg.client_id);
check("grant listed in clients page API", !!grant, JSON.stringify(grants).slice(0, 200));
const autoCode = new URL(auto.headers.get("location"), BASE).searchParams.get("code");
const tokens2 = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: autoCode,
    code_verifier: verifier2,
    client_id: reg.client_id,
    redirect_uri: "http://127.0.0.1:9999/callback",
  }),
}).then((r) => r.json());
await fetch(`${BASE}/api/clients/${grant.id}/revoke`, { method: "POST", headers: authHeaders });
const revokedGrantCall = await mcpCall(tokens2.access_token, "whoami");
check("revoked grant blocks access token", revokedGrantCall.status === 401, revokedGrantCall.text);

// admin endpoints
const adminUsers = await fetch(`${BASE}/api/admin/users?per_page=10`, { headers: authHeaders }).then((r) => r.json());
check("admin users list", adminUsers.total >= 1);
const invite = await fetch(`${BASE}/api/admin/users`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "invitee@example.com", role: "user" }),
});
check("admin invite user", invite.status === 201);
const adminClients = await fetch(`${BASE}/api/admin/clients?q=E2E`, { headers: authHeaders }).then((r) => r.json());
check("admin clients list + search", adminClients.items.some((c) => c.clientName === "E2E Client"));
const audit = await fetch(`${BASE}/api/admin/audit?action=token.create`, { headers: authHeaders }).then((r) => r.json());
check("audit log filter", audit.items.length >= 1 && audit.items.every((a) => a.action === "token.create"));
const overview = await fetch(`${BASE}/api/overview`, { headers: authHeaders }).then((r) => r.json());
check("overview stats", typeof overview.activeTokens === "number" && Array.isArray(overview.recentActivity));
const activity = await fetch(`${BASE}/api/activity?action=token.create`, { headers: authHeaders }).then((r) => r.json());
check(
  "user activity list + filter",
  activity.items.length >= 1 && activity.items.every((entry) => entry.action === "token.create"),
);

// settings
const patch = await fetch(`${BASE}/api/me`, {
  method: "PATCH",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ displayName: "Shin", preferences: { theme: "dark", pageSize: 50 } }),
}).then((r) => r.json());
check("update profile+preferences", patch.displayName === "Shin" && patch.preferences.theme === "dark");
const sessionsList = await fetch(`${BASE}/api/me/sessions`, { headers: authHeaders }).then((r) => r.json());
check("sessions list marks current", sessionsList.items.some((s) => s.current));

// --- chat assistant (provider CRUD; streaming needs a real API key) ---
await pool.query("delete from chat_conversations where title like 'smoke:%'");
const chatProviders = await fetch(`${BASE}/api/chat/providers`, { headers: authHeaders }).then((r) => r.json());
check("chat providers endpoint", Array.isArray(chatProviders.providers));
if (chatProviders.enabled) {
  const created = await fetch(`${BASE}/api/chat/conversations`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  check("create chat conversation", !!created.conversation?.id, JSON.stringify(created));
  const convId = created.conversation.id;
  await fetch(`${BASE}/api/chat/conversations/${convId}`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "smoke: chat" }),
  });
  const chatList = await fetch(`${BASE}/api/chat/conversations?q=smoke`, { headers: authHeaders }).then((r) => r.json());
  check("chat conversations list + search", chatList.items.some((cv) => cv.id === convId));
  // Message send returns ndjson; with a dummy key the provider call fails → error line, never a crash.
  const sendRes = await fetch(`${BASE}/api/chat/conversations/${convId}/messages`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hello" }),
  });
  const ndjson = await sendRes.text();
  const lines = ndjson.trim().split("\n").map((l) => JSON.parse(l));
  const last = lines[lines.length - 1];
  check("chat message stream is valid ndjson", sendRes.status === 200 && (last.type === "done" || last.type === "error"), ndjson.slice(0, 200));
  const del = await fetch(`${BASE}/api/chat/conversations/${convId}`, { method: "DELETE", headers: authHeaders });
  check("delete chat conversation", del.status === 200);
} else {
  console.log("skip  chat CRUD (no provider key configured)");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
