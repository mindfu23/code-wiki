/**
 * Shared auth helpers — session crypto, cookie parsing, access-level derivation.
 *
 * Session kinds:
 * - undefined / 'owner': full GitHub OAuth session. canWrite if access_token present;
 *   canAdmin / canReadPrivate only if login matches GITHUB_REPO_OWNER.
 * - 'viewer': passcode-redeemed read-only session. canReadPrivate, no writes.
 * - 'editor': passcode-redeemed read+scoped-write session (Phase 3, not yet wired).
 *
 * Legacy OAuth cookies (without `kind`) decrypt cleanly and behave the same as
 * before this refactor — kind is optional and the OAuth code path covers them.
 */

import * as crypto from 'crypto';
import type { HandlerEvent } from '@netlify/functions';

const SESSION_SECRET = process.env.SESSION_SECRET;
const GITHUB_REPO_OWNER = (process.env.GITHUB_REPO_OWNER || '').toLowerCase();

export type SessionKind = 'owner' | 'editor' | 'viewer';

export interface Session {
  /** GitHub OAuth token. Present for owner/member sessions, absent for passcode sessions. */
  access_token?: string;
  user_id?: number;
  /** GitHub login for OAuth sessions; opaque demo identifier for passcode sessions. */
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string;
  /** Tier. Absent on legacy OAuth cookies — treat as OAuth path. */
  kind?: SessionKind;
  /** Expiration as ms-since-epoch. */
  exp: number;
}

export interface AccessLevel {
  /** Allowed to read private repos / private documents. */
  canReadPrivate: boolean;
  /** Allowed to invoke save-* endpoints. GitHub still enforces per-repo write. */
  canWrite: boolean;
  /** Allowed to invoke admin endpoints (rebuild-index, etc). */
  canAdmin: boolean;
  /** Display string for logging — never trust for security decisions. */
  identity: string;
  /** Decoded session (or null for anonymous). */
  session: Session | null;
}

export const ANON_ACCESS: AccessLevel = {
  canReadPrivate: false,
  canWrite: false,
  canAdmin: false,
  identity: 'anonymous',
  session: null,
};

/** Parse a Cookie header into a flat record. */
export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name && rest.length > 0) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}

/** Encrypt a session payload with AES-256-GCM. Format: `iv.encrypted.authTag` (all base64). */
export function encryptSession(data: Session): string {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  const key = Buffer.from(SESSION_SECRET.slice(0, 32), 'utf-8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${encrypted}.${authTag.toString('base64')}`;
}

/** Decrypt and validate a session token. Returns null for missing/invalid/expired tokens. */
export function decryptSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return null;
  try {
    const [ivB64, encryptedB64, authTagB64] = token.split('.');
    if (!ivB64 || !encryptedB64 || !authTagB64) return null;
    const key = Buffer.from(SESSION_SECRET.slice(0, 32), 'utf-8');
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    const data = JSON.parse(decrypted) as Session;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Build a Set-Cookie header value for the wiki_session cookie. */
export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return `wiki_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/`;
}

/** Build a Set-Cookie header value to clear the wiki_session cookie. */
export const CLEAR_SESSION_COOKIE = 'wiki_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/';

/**
 * Compute the access level for a request. Single source of truth — every endpoint
 * that gates on session state should call this and branch on the returned struct
 * rather than re-implementing the rules.
 */
export function getAccessLevel(event: HandlerEvent): AccessLevel {
  const cookies = parseCookies(event.headers.cookie);
  const session = decryptSession(cookies.wiki_session);
  if (!session) return ANON_ACCESS;

  // Passcode-redeemed sessions: kind drives capabilities, no access_token in play.
  if (session.kind === 'viewer') {
    return {
      canReadPrivate: true,
      canWrite: false,
      canAdmin: false,
      identity: session.login,
      session,
    };
  }
  if (session.kind === 'editor') {
    // Phase 3 territory — write path not yet wired into save-* functions.
    return {
      canReadPrivate: true,
      canWrite: true,
      canAdmin: false,
      identity: session.login,
      session,
    };
  }

  // OAuth path (kind undefined or 'owner'). Owner identity comes from login match
  // against GITHUB_REPO_OWNER — this is the only thing that grants admin / private read.
  const isOwner = !!GITHUB_REPO_OWNER && session.login.toLowerCase() === GITHUB_REPO_OWNER;
  return {
    canReadPrivate: isOwner,
    canWrite: !!session.access_token,
    canAdmin: isOwner,
    identity: session.login,
    session,
  };
}
