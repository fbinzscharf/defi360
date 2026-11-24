// Worker for defi360.news.
//
// Static files in ./site are served by Cloudflare directly. This script only
// runs for paths that are not files, which in practice means the signup API:
//
//   POST /api/subscribe   takes an email address and sends a confirmation link
//   GET  /api/confirm     checks the link, adds the contact in Resend, sends the welcome email
//
// Sign-up is double opt-in. Nothing is stored until the reader clicks the
// link: the link itself carries the address, an expiry day and a signature
// made with SIGNING_SECRET, so no database is needed.

import { confirmationEmail, welcomeEmail } from "./emails.js";

const RESEND_API = "https://api.resend.com";
const LINK_VALID_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribe") {
      if (request.method !== "POST") return text("Method not allowed", 405, { Allow: "POST" });
      return subscribe(request, env, url);
    }

    if (url.pathname === "/api/confirm") {
      if (request.method !== "GET") return text("Method not allowed", 405, { Allow: "GET" });
      return confirm(env, url);
    }

    // Anything else that reached the Worker is not a file in ./site.
    // Hand it back to the asset handler so it returns the normal 404.
    return env.ASSETS.fetch(request);
  },
};

// ---------------------------------------------------------------------------
// POST /api/subscribe
// ---------------------------------------------------------------------------

async function subscribe(request, env, url) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const reply = (ok, status, message) =>
    wantsJson
      ? json({ ok, message }, status)
      : redirect(url, ok ? "/check-email.html" : "/subscribe-error.html");

  if (!configured(env)) {
    console.error("subscribe: RESEND_API_KEY or SIGNING_SECRET is not set");
    return reply(false, 503, "Sign-up is not available right now. Please try again later.");
  }

  // Browsers send Origin on form posts. Reject posts made from another site.
  const origin = request.headers.get("Origin");
  if (origin && originHost(origin) !== url.host) {
    return reply(false, 403, "This form can only be used on defi360.news.");
  }

  let fields;
  try {
    fields = await readFields(request);
  } catch (error) {
    return reply(false, 400, "We could not read that request.");
  }

  // "company" is a hidden field that people never see. Only bots fill it in.
  // Answer as if it worked so the bot learns nothing.
  if (fields.company) return reply(true, 200, CHECK_INBOX);

  const email = normalizeEmail(fields.email);
  if (!email) return reply(false, 400, "Please enter a valid email address.");

  const expiryDay = Math.floor(Date.now() / DAY_MS) + LINK_VALID_DAYS;
  const token = await signToken(email, expiryDay, env.SIGNING_SECRET);
  const link = `${siteUrl(env, url)}/api/confirm?token=${encodeURIComponent(token)}`;
  const message = confirmationEmail(link);

  // The key makes Resend send at most one confirmation per address per day,
  // however many times the form is submitted with it.
  const key = `confirm/${await shortHash(email)}/${expiryDay}`;
  const sent = await resend(env, "POST", "/emails", outgoing(env, email, message), key);

  if (!sent.ok) {
    console.error(`subscribe: Resend refused the confirmation email (${sent.status}) ${sent.detail}`);
    return reply(false, 502, "We could not send the confirmation email. Please try again in a minute.");
  }

  return reply(true, 200, CHECK_INBOX);
}

const CHECK_INBOX = "Check your inbox and click the link to confirm.";

// ---------------------------------------------------------------------------
// GET /api/confirm?token=...
// ---------------------------------------------------------------------------

async function confirm(env, url) {
  if (!configured(env)) {
    console.error("confirm: RESEND_API_KEY or SIGNING_SECRET is not set");
    return redirect(url, "/subscribe-error.html");
  }

  const email = await readToken(url.searchParams.get("token") || "", env.SIGNING_SECRET);
  if (!email) return redirect(url, "/subscribe-error.html");

  // Add the contact. If the address is already a contact (for example someone
  // who unsubscribed and is signing up again), mark it subscribed instead.
  let saved = await resend(env, "POST", "/contacts", { email, unsubscribed: false });
  if (!saved.ok) {
    saved = await resend(env, "PATCH", `/contacts/${encodeURIComponent(email)}`, { unsubscribed: false });
  }
  if (!saved.ok) {
    console.error(`confirm: Resend could not save the contact (${saved.status}) ${saved.detail}`);
    return redirect(url, "/subscribe-error.html");
  }

  // Optional: put the contact in the segment the brief is sent to.
  if (env.RESEND_SEGMENT_ID) {
    const added = await resend(
      env,
      "POST",
      `/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(env.RESEND_SEGMENT_ID)}`
    );
    if (!added.ok) {
      console.error(`confirm: could not add the contact to the segment (${added.status}) ${added.detail}`);
    }
  }

  // The reader is subscribed at this point, so a failed welcome email is
  // logged and does not turn the confirmation into an error page. The key
  // stops a second welcome if the link is opened twice within a day.
  const message = welcomeEmail(siteUrl(env, url));
  const welcomed = await resend(
    env, "POST", "/emails", outgoing(env, email, message), `welcome/${await shortHash(email)}`
  );
  if (!welcomed.ok) {
    console.error(`confirm: Resend refused the welcome email (${welcomed.status}) ${welcomed.detail}`);
  }

  return redirect(url, "/subscribed.html");
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

async function resend(env, method, path, body, idempotencyKey) {
  const headers = { Authorization: `Bearer ${env.RESEND_API_KEY}` };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  try {
    const response = await fetch(RESEND_API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) return { ok: true, status: response.status, detail: "" };
    const detail = (await response.text()).slice(0, 300);
    return { ok: false, status: response.status, detail };
  } catch (error) {
    return { ok: false, status: 0, detail: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------
// Token format: <email, base64url>.<expiry day number>.<HMAC-SHA256, base64url>

export async function signToken(email, expiryDay, secret) {
  const payload = `${toBase64Url(new TextEncoder().encode(email))}.${expiryDay}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

// Returns the email address if the token is genuine and not expired, else null.
export async function readToken(token, secret, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedEmail, expiryText, signature] = parts;

  const expected = await hmac(`${encodedEmail}.${expiryText}`, secret);
  if (!sameString(signature, expected)) return null;

  const expiryDay = Number(expiryText);
  if (!Number.isInteger(expiryDay) || Math.floor(now / DAY_MS) > expiryDay) return null;

  try {
    return normalizeEmail(new TextDecoder().decode(fromBase64Url(encodedEmail)));
  } catch (error) {
    return null;
  }
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

// Compares in a way that does not reveal how many leading characters matched.
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function shortHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest)).slice(0, 22);
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function configured(env) {
  return Boolean(env.RESEND_API_KEY && env.SIGNING_SECRET);
}

// Builds the body for Resend's send-email call. REPLY_TO is optional: the
// sending domain cannot receive mail, so without it replies go nowhere.
function outgoing(env, to, message) {
  const body = {
    from: env.FROM_ADDRESS || "The DeFi360 Desk <desk@mail.defi360.news>",
    to: [to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (env.REPLY_TO) body.reply_to = env.REPLY_TO;
  return body;
}

// Links in emails use SITE_URL when set, so they point at the public site
// even if the Worker was reached through a preview address.
function siteUrl(env, url) {
  return (env.SITE_URL || url.origin).replace(/\/+$/, "");
}

function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch (error) {
    return "";
  }
}

async function readFields(request) {
  const type = request.headers.get("Content-Type") || "";
  if (type.includes("application/json")) {
    const body = await request.json();
    return { email: body.email, company: body.company };
  }
  const form = await request.formData();
  return { email: form.get("email"), company: form.get("company") };
}

// Returns a trimmed, lower-case address, or null if it does not look like one.
export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[a-z0-9-]{2,}$/.test(email)) return null;
  return email;
}

function redirect(url, path) {
  return new Response(null, { status: 303, headers: { Location: new URL(path, url.origin).toString() } });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(body, status, headers = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}
