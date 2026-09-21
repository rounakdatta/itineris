import { describe, it, expect, vi } from "vitest";
import {
  uidFor, signSession, readSession, newSession, authorizeUrl, exchangeCode,
  readIdToken, allowedBy, redirectUriFor, safeNext, SESSION_DAYS,
} from "../server/auth.js";

const SECRET = "a-test-secret";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.signature-not-checked`;
const GOOD = { iss: "https://accounts.google.com", aud: "client-1", email: "Rounak@Example.com", email_verified: true, name: "Rounak", picture: "https://x/p.png", sub: "1234", exp: Math.floor(Date.now() / 1000) + 600 };

describe("who somebody is", () => {
  it("keys a person by their address, case and spacing aside", () => {
    expect(uidFor("rounak@example.com")).toBe(uidFor("  Rounak@Example.COM "));
    expect(uidFor("a@example.com")).not.toBe(uidFor("b@example.com"));
    expect(uidFor("a@example.com")).toMatch(/^[0-9a-f]{16}$/);   // it names a directory
  });
});

describe("the session cookie", () => {
  it("round-trips what was put in it", () => {
    const s = newSession({ email: "Rounak@Example.com", name: "Rounak", picture: "p", sub: "9" });
    const claims = readSession(signSession(s, SECRET), SECRET);
    expect(claims).toMatchObject({ email: "rounak@example.com", uid: uidFor("rounak@example.com"), name: "Rounak", sub: "9" });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + (SESSION_DAYS - 1) * 86400);
  });
  it("refuses a cookie that has been edited, re-signed with another key, or is past its date", () => {
    const token = signSession(newSession({ email: "a@example.com" }), SECRET);
    expect(readSession(token, SECRET)).not.toBeNull();
    // Swap the payload for somebody else's and keep the signature.
    const forged = `${b64({ email: "victim@example.com", uid: uidFor("victim@example.com"), exp: 2 ** 31 })}.${token.split(".")[1]}`;
    expect(readSession(forged, SECRET)).toBeNull();
    expect(readSession(token, "a-different-secret")).toBeNull();
    expect(readSession(signSession({ email: "a@example.com", exp: Math.floor(Date.now() / 1000) - 1 }, SECRET), SECRET)).toBeNull();
  });
  it("refuses junk instead of throwing", () => {
    for (const junk of [undefined, null, "", "nodot", "a.b.c", "....", 42, {}]) expect(readSession(junk, SECRET)).toBeNull();
  });
});

describe("Google's authorization-code flow", () => {
  it("asks for exactly the three things it needs, and no offline access", () => {
    const u = new URL(authorizeUrl({ clientId: "client-1", redirectUri: "https://x/creator/auth/callback", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("access_type")).toBeNull();   // nothing is read from Google later
  });
  it("swaps the code for tokens, and reports Google's own complaint when it will not", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: jwt(GOOD) }) }));
    const t = await exchangeCode({ code: "c", clientId: "client-1", clientSecret: "s", redirectUri: "https://x/cb", fetchFn });
    expect(t.id_token).toBeTruthy();
    const body = fetchFn.mock.calls[0][1].body;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("s");
    const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Bad code" }) });
    await expect(exchangeCode({ code: "c", clientId: "c1", clientSecret: "s", redirectUri: "r", fetchFn: bad })).rejects.toThrow("Bad code");
  });
  it("reads the identity out of the id_token and insists it is ours, fresh and verified", () => {
    expect(readIdToken(jwt(GOOD), { clientId: "client-1" })).toEqual({ email: "rounak@example.com", name: "Rounak", picture: "https://x/p.png", sub: "1234" });
    expect(() => readIdToken(jwt({ ...GOOD, aud: "someone-else" }), { clientId: "client-1" })).toThrow(/different client/);
    expect(() => readIdToken(jwt({ ...GOOD, iss: "https://evil.example" }), { clientId: "client-1" })).toThrow(/issuer/);
    expect(() => readIdToken(jwt({ ...GOOD, exp: 1 }), { clientId: "client-1" })).toThrow(/expired/);
    expect(() => readIdToken(jwt({ ...GOOD, email_verified: false }), { clientId: "client-1" })).toThrow(/not verified/);
    expect(() => readIdToken(jwt({ ...GOOD, email: "" }), { clientId: "client-1" })).toThrow(/e-mail/);
    expect(() => readIdToken("not-a-jwt", { clientId: "client-1" })).toThrow(/not a JWT/);
  });
});

describe("the guest list", () => {
  it("is open when empty -- which is the point of Make my own", () => {
    const anyone = allowedBy("");
    expect(anyone("stranger@example.com")).toBe(true);
    const few = allowedBy(" A@example.com , b@example.com ");
    expect(few("a@EXAMPLE.com")).toBe(true);
    expect(few("c@example.com")).toBe(false);
  });
});

describe("coming back from Google", () => {
  const req = (url, headers = {}) => ({ url, header: (h) => headers[h.toLowerCase()] });
  it("works out its own public address, and prefers what it was told", () => {
    expect(redirectUriFor(req("http://127.0.0.1:8080/creator/auth/google"), "")).toBe("http://127.0.0.1:8080/creator/auth/callback");
    expect(redirectUriFor(req("http://in-cluster/creator/auth/google", { "x-forwarded-proto": "https", "x-forwarded-host": "itineris.taptappers.club" }), "")).toBe("https://itineris.taptappers.club/creator/auth/callback");
    expect(redirectUriFor(req("http://in-cluster/x"), "https://itineris.taptappers.club/")).toBe("https://itineris.taptappers.club/creator/auth/callback");
  });
  it("only ever sends people back to a path on this site", () => {
    expect(safeNext("/creator/?tab=galleries")).toBe("/creator/?tab=galleries");
    expect(safeNext("https://evil.example/steal")).toBe("/creator/");
    expect(safeNext("//evil.example/steal")).toBe("/creator/");
    expect(safeNext(undefined)).toBe("/creator/");
  });
});
