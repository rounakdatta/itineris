// Who is signing in, and how we remember them.
//
// The creator app used to sit behind tinyauth: Traefik authenticated the
// request and handed this process a `Remote-Email` header it simply trusted.
// That works for one person behind a private proxy and is a hole the moment
// the service is reachable directly -- anyone can set a header. Now that
// anybody can make their own journal, itineris does the whole thing itself:
// Google's authorization-code flow, and a signed cookie afterwards.
//
// The header is still accepted, but ONLY when no Google client is configured,
// so a deployment is either "Google" or "behind a trusted proxy" and never
// quietly both.
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const unb64url = (s) => Buffer.from(s, "base64url");

// A person's files live under this. Derived from the e-mail rather than
// Google's `sub` so that the journal a deployment already had -- written when
// identity WAS an e-mail from the proxy -- is still theirs after they sign in
// with Google for the first time. Stable in practice; a changed Google address
// means a fresh space, which is a trade recorded here on purpose.
export const uidFor = (email) => createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 16);

export const normalizeEmail = (e) => String(e ?? "").trim().toLowerCase();

// ---- sessions ---------------------------------------------------------------
// A signed cookie, not a server-side table: this process has one replica and a
// volume, and a table would be one more thing to migrate. `exp` is inside the
// signature, so a stale cookie cannot be replayed by editing it.
export const SESSION_COOKIE = "itineris_session";
export const SESSION_DAYS = 30;

export function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

export function readSession(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".", 2);
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  let got;
  try { got = unb64url(mac); } catch { return null; }
  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a mismatch rather than returning false.
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let claims;
  try { claims = JSON.parse(unb64url(body).toString("utf8")); } catch { return null; }
  if (!claims || typeof claims.email !== "string") return null;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return null;
  return claims;
}

export const newSession = (user, now = Date.now()) => ({
  email: normalizeEmail(user.email),
  uid: uidFor(user.email),
  name: user.name ?? "",
  picture: user.picture ?? "",
  sub: user.sub ?? null,
  exp: Math.floor(now / 1000) + SESSION_DAYS * 24 * 3600,
});

// ---- Google's authorization-code flow ---------------------------------------
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const randomState = () => b64url(randomBytes(24));

export function authorizeUrl({ clientId, redirectUri, state, endpoint = AUTH_ENDPOINT }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // A refresh token is of no use here -- nothing is read from Google after
    // sign-in -- so do not ask for offline access, and do not nag on return.
    prompt: "select_account",
  });
  return `${endpoint}?${q}`;
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, endpoint = TOKEN_ENDPOINT, fetchFn = fetch }) {
  const r = await fetchFn(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(body.error_description || body.error || `token endpoint: HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  if (!body.id_token) throw new Error("Google did not return an id_token");
  return body;
}

// The id_token arrives from Google over TLS in direct response to our own
// request, so its signature is not re-verified here (Google documents this as
// sufficient for the code flow); what IS checked is that it says what it must.
export function readIdToken(idToken, { clientId, now = Date.now() } = {}) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("id_token is not a JWT");
  let c;
  try { c = JSON.parse(unb64url(parts[1]).toString("utf8")); } catch { throw new Error("id_token payload is not JSON"); }
  const iss = String(c.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") throw new Error(`unexpected issuer ${iss || "(none)"}`);
  if (clientId && c.aud !== clientId) throw new Error("id_token was issued for a different client");
  if (Number.isFinite(c.exp) && c.exp * 1000 <= now) throw new Error("id_token has expired");
  const email = normalizeEmail(c.email);
  if (!email) throw new Error("Google did not share an e-mail address");
  // Unverified addresses can be anyone's; a journal is keyed on the address.
  if (c.email_verified === false) throw new Error("that Google address is not verified");
  return { email, name: c.name ?? "", picture: c.picture ?? "", sub: c.sub ?? null };
}

// An optional guest list. Empty means anyone with a Google account may make
// their own journal, which is the point of the "Make my own" button.
export const allowedBy = (list) => {
  const allow = String(list ?? "").split(",").map(normalizeEmail).filter(Boolean);
  return (email) => allow.length === 0 || allow.includes(normalizeEmail(email));
};

// Where Google must send people back to. Derived from the request when the
// deployment has not been told its own public URL, so a laptop and the cluster
// both work without configuration.
export function redirectUriFor(req, configured, path = "/creator/auth/callback") {
  if (configured) return `${String(configured).replace(/\/+$/, "")}${path}`;
  const u = new URL(req.url);
  const proto = req.header("x-forwarded-proto") || u.protocol.replace(":", "");
  const host = req.header("x-forwarded-host") || req.header("host") || u.host;
  return `${proto}://${host}${path}`;
}

// Only ever send people back to a path on this site: `?next=https://evil` is
// how an open redirect gets built.
export function safeNext(next, fallback = "/creator/") {
  const s = String(next ?? "");
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  return s;
}
