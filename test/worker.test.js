// Tests for the signup flow. Run with: npm test
// Resend is replaced by a stand-in, so no email is sent and no key is needed.

import test from "node:test";
import assert from "node:assert/strict";
import worker, { signToken, readToken, normalizeEmail } from "../src/worker.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => Math.floor(Date.now() / DAY_MS);

function setup(respond = () => new Response("{}", { status: 200 })) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return respond(call);
  };
  const env = {
    RESEND_API_KEY: "re_test",
    SIGNING_SECRET: "test-secret",
    SITE_URL: "https://defi360.news",
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  };
  return { calls, env };
}

function post(body, headers = {}) {
  return new Request("https://defi360.news/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("normalizeEmail accepts real addresses and rejects junk", () => {
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  for (const bad of ["", "ada", "ada@", "ada@example", "a b@example.com", "ada@@example.com", null, 42]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test("tokens round-trip, and reject tampering, wrong secret and expiry", async () => {
  const token = await signToken("ada@example.com", today() + 3, "s1");
  assert.equal(await readToken(token, "s1"), "ada@example.com");
  assert.equal(await readToken(token, "s2"), null);
  assert.equal(await readToken(token.replace(/^./, "X"), "s1"), null);
  assert.equal(await readToken("garbage", "s1"), null);
  assert.equal(await readToken(token, "s1", Date.now() + 5 * DAY_MS), null);
});

test("subscribe sends one confirmation email and stores no contact", async () => {
  const { calls, env } = setup();
  const response = await worker.fetch(post({ email: "Ada@Example.com" }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(calls[0].body.to, ["ada@example.com"]);
  assert.equal(calls[0].headers.Authorization, "Bearer re_test");
  assert.match(calls[0].headers["Idempotency-Key"], /^confirm\//);
  const link = calls[0].body.text.match(/https:\/\/defi360\.news\/api\/confirm\?token=\S+/)[0];
  const token = decodeURIComponent(new URL(link).searchParams.get("token"));
  assert.equal(await readToken(token, "test-secret"), "ada@example.com");
});

test("two sign-ups for one address on one day are identical requests", async () => {
  const { calls, env } = setup();
  await worker.fetch(post({ email: "ada@example.com" }), env);
  await worker.fetch(post({ email: "ada@example.com" }), env);
  assert.equal(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
  assert.deepEqual(calls[0].body, calls[1].body);
});

test("subscribe rejects bad addresses and other sites, and ignores bots", async () => {
  const { calls, env } = setup();
  assert.equal((await worker.fetch(post({ email: "nope" }), env)).status, 400);
  assert.equal((await worker.fetch(post({ email: "ada@example.com" }, { Origin: "https://evil.example" }), env)).status, 403);
  const bot = await worker.fetch(post({ email: "ada@example.com", company: "Acme" }), env);
  assert.equal(bot.status, 200);
  assert.equal(calls.length, 0);
});

test("a plain form post is answered with a redirect", async () => {
  const { env } = setup();
  const request = new Request("https://defi360.news/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://defi360.news" },
    body: "email=ada%40example.com&company=",
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "https://defi360.news/check-email.html");
});

test("subscribe reports a failure when Resend refuses the email", async () => {
  const { env } = setup(() => new Response('{"message":"nope"}', { status: 422 }));
  assert.equal((await worker.fetch(post({ email: "ada@example.com" }), env)).status, 502);
});

test("subscribe is unavailable until the secrets are set", async () => {
  const { calls, env } = setup();
  delete env.SIGNING_SECRET;
  assert.equal((await worker.fetch(post({ email: "ada@example.com" }), env)).status, 503);
  assert.equal(calls.length, 0);
});

test("confirm adds the contact, sends the welcome email and redirects", async () => {
  const { calls, env } = setup();
  env.RESEND_SEGMENT_ID = "seg_1";
  env.REPLY_TO = "desk@defi360.news";
  const token = await signToken("ada@example.com", today() + 3, env.SIGNING_SECRET);
  const response = await worker.fetch(new Request(`https://defi360.news/api/confirm?token=${encodeURIComponent(token)}`), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "https://defi360.news/subscribed.html");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.resend.com", "")}`), [
    "POST /contacts",
    "POST /contacts/ada%40example.com/segments/seg_1",
    "POST /emails",
  ]);
  assert.deepEqual(calls[0].body, { email: "ada@example.com", unsubscribed: false });
  assert.equal(calls[2].body.reply_to, "desk@defi360.news");
  assert.match(calls[2].headers["Idempotency-Key"], /^welcome\//);
});

test("confirm re-subscribes an existing contact", async () => {
  const { calls, env } = setup((call) =>
    call.method === "POST" && call.url.endsWith("/contacts")
      ? new Response('{"message":"exists"}', { status: 409 })
      : new Response("{}", { status: 200 })
  );
  const token = await signToken("ada@example.com", today() + 3, env.SIGNING_SECRET);
  const response = await worker.fetch(new Request(`https://defi360.news/api/confirm?token=${encodeURIComponent(token)}`), env);
  assert.equal(response.headers.get("Location"), "https://defi360.news/subscribed.html");
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url, "https://api.resend.com/contacts/ada%40example.com");
});

test("confirm rejects a forged or missing token without calling Resend", async () => {
  const { calls, env } = setup();
  for (const query of ["", "?token=abc", "?token=a.b.c"]) {
    const response = await worker.fetch(new Request(`https://defi360.news/api/confirm${query}`), env);
    assert.equal(response.headers.get("Location"), "https://defi360.news/subscribe-error.html");
  }
  assert.equal(calls.length, 0);
});

test("other paths fall through to the static files", async () => {
  const { env } = setup();
  assert.equal((await worker.fetch(new Request("https://defi360.news/nope"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://defi360.news/api/subscribe"), env)).status, 405);
});
