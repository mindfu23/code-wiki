/**
 * Demo Login - Redeem a shared passcode for a tier-scoped read-only session.
 *
 * GET /.netlify/functions/demo-login?passcode=<code>&redirect=<same-origin path>
 *
 * - Validates passcode against DEMO_VIEWER_PASSCODE (comma-separated list).
 * - On success: builds a viewer-tier Session, encrypts it, sets wiki_session
 *   cookie, redirects to the requested path (validated to same-origin).
 * - Session TTL is DEMO_SESSION_TTL_HOURS (default 4) — much shorter than the
 *   30-day OAuth session, so leaked passcodes have a smaller blast radius.
 *
 * Constant-time passcode comparison so we don't leak which list matched, and
 * a generic 401 message regardless of which validation step failed.
 *
 * Phase 3 will extend this to DEMO_EDITOR_PASSCODE → editor-tier sessions.
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as crypto from 'crypto';
import {
  encryptSession,
  buildSessionCookie,
  type Session,
  type SessionKind,
} from './_shared/auth.js';

const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';
const DEFAULT_TTL_HOURS = 4;

interface PasscodeMatch {
  kind: SessionKind;
  /** Short hash of the passcode; goes into the demo identity for log correlation. */
  passcodeHash: string;
}

/** Constant-time compare two strings of equal length; false otherwise. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
}

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/** Compare a candidate passcode against a comma-separated env var list. */
function matchesEnvList(envValue: string | undefined, candidate: string): boolean {
  if (!envValue) return false;
  let matched = false;
  for (const raw of envValue.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Walk all entries even after a match so timing is independent of position.
    if (constantTimeEquals(trimmed, candidate)) matched = true;
  }
  return matched;
}

/**
 * Identify which passcode tier the candidate belongs to.
 * Order: viewer first, then editor (Phase 3).
 */
function classifyPasscode(candidate: string): PasscodeMatch | null {
  if (matchesEnvList(process.env.DEMO_VIEWER_PASSCODE, candidate)) {
    return { kind: 'viewer', passcodeHash: shortHash(candidate) };
  }
  // Phase 3: editor tier. Wired up here for forward compatibility — the
  // save-* endpoints don't yet honor editor sessions, so writes will still
  // 403 until that wiring lands.
  if (matchesEnvList(process.env.DEMO_EDITOR_PASSCODE, candidate)) {
    return { kind: 'editor', passcodeHash: shortHash(candidate) };
  }
  return null;
}

/**
 * Validate a redirect target. Only allow same-origin paths starting with `/`
 * to prevent open-redirect abuse (?redirect=https://evil.example/...).
 */
function safeRedirectPath(redirect: string | undefined): string {
  if (!redirect) return '/';
  // Reject any input that looks like an absolute URL or protocol-relative path.
  if (redirect.startsWith('//')) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(redirect)) return '/';
  if (!redirect.startsWith('/')) return '/';
  return redirect;
}

function htmlError(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Demo access</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:8vh auto;padding:0 1rem;color:#1e293b}
.card{background:#f1f5f9;border-radius:8px;padding:1.5rem}
h1{margin-top:0;font-size:1.25rem}p{line-height:1.5}a{color:#0369a1}</style></head>
<body><div class="card"><h1>Demo access</h1><p>${message}</p>
<p><a href="/">← Back to site</a></p></div></body></html>`;
}

const HTML_HEADERS: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HTML_HEADERS, body: 'Method not allowed' };
  }

  // Accept passcode from query string (link-style) or POST body (form-style).
  const params = event.queryStringParameters || {};
  let passcode = params.passcode || '';
  let redirect = params.redirect || '/';
  if (event.httpMethod === 'POST' && event.body) {
    try {
      const body = JSON.parse(event.body) as { passcode?: string; redirect?: string };
      if (body.passcode) passcode = body.passcode;
      if (body.redirect) redirect = body.redirect;
    } catch {
      // Body parsing is best-effort; query-string still applies.
    }
  }

  if (!passcode) {
    return {
      statusCode: 400,
      headers: HTML_HEADERS,
      body: htmlError('Missing passcode.'),
    };
  }

  // SESSION_SECRET is required to mint cookies.
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return {
      statusCode: 500,
      headers: HTML_HEADERS,
      body: htmlError('Server is missing SESSION_SECRET. Contact the site owner.'),
    };
  }

  const match = classifyPasscode(passcode);
  if (!match) {
    // Generic 401 — never reveal which list (viewer / editor) was checked.
    return {
      statusCode: 401,
      headers: HTML_HEADERS,
      body: htmlError('Invalid demo passcode.'),
    };
  }

  const ttlHours =
    Number(process.env.DEMO_SESSION_TTL_HOURS) > 0
      ? Number(process.env.DEMO_SESSION_TTL_HOURS)
      : DEFAULT_TTL_HOURS;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const ttlSeconds = Math.floor(ttlMs / 1000);

  const session: Session = {
    login: `demo:${match.kind}:${match.passcodeHash}`,
    kind: match.kind,
    exp: Date.now() + ttlMs,
  };

  const token = encryptSession(session);
  console.log(
    `[demo-login] minted ${match.kind} session passcodeHash=${match.passcodeHash} ttlHours=${ttlHours}`
  );

  const target = safeRedirectPath(redirect);
  const location = `${SITE_URL}${target === '/' ? '' : target}`;
  return {
    statusCode: 302,
    headers: { Location: location } as Record<string, string>,
    multiValueHeaders: {
      'Set-Cookie': [buildSessionCookie(token, ttlSeconds)],
    },
    body: '',
  };
};

export { handler };
