/**
 * OAuth Callback - Handles GitHub OAuth callback
 * Exchanges authorization code for access token and creates session
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as crypto from 'crypto';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';

interface SessionData {
  access_token: string;
  user_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  exp: number;
}

// Parse cookies from header
function parseCookies(cookieHeader: string): Record<string, string> {
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

// Encrypt session data using AES-256-GCM
function encryptSession(data: SessionData): string {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  const key = Buffer.from(SESSION_SECRET.slice(0, 32), 'utf-8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv.encrypted.authTag (all base64)
  return `${iv.toString('base64')}.${encrypted}.${authTag.toString('base64')}`;
}

// Helper function for redirect responses with consistent typing
function redirectResponse(
  location: string,
  cookies?: string[],
  cacheControl?: string
): { statusCode: number; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { Location: location };
  if (cookies && cookies.length > 0) {
    headers['Set-Cookie'] = cookies.join(', ');
  }
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }
  return { statusCode: 302, headers, body: '' };
}

const handler: Handler = async (event: HandlerEvent) => {
  const { code, state, error, error_description } = event.queryStringParameters || {};

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error, error_description);
    return redirectResponse(
      `${SITE_URL}/#/login?error=${encodeURIComponent(error_description || error)}`
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return redirectResponse(
      `${SITE_URL}/#/login?error=${encodeURIComponent('Missing authorization code')}`
    );
  }

  // Verify state for CSRF protection
  const cookies = parseCookies(event.headers.cookie || '');
  if (state !== cookies.oauth_state) {
    console.error('State mismatch:', { expected: cookies.oauth_state, received: state });
    return redirectResponse(
      `${SITE_URL}/#/login?error=${encodeURIComponent('Invalid OAuth state')}`
    );
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${SITE_URL}/.netlify/functions/oauth-callback`,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error('Token exchange error:', tokenData);
      return redirectResponse(
        `${SITE_URL}/#/login?error=${encodeURIComponent(tokenData.error_description || 'Failed to get access token')}`
      );
    }

    const accessToken = tokenData.access_token;

    // Fetch user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Code-Wiki-App',
      },
    });

    if (!userResponse.ok) {
      console.error('Failed to fetch user:', userResponse.status);
      return redirectResponse(
        `${SITE_URL}/#/login?error=${encodeURIComponent('Failed to fetch user info')}`
      );
    }

    const user = await userResponse.json();

    // Create session data
    const sessionData: SessionData = {
      access_token: accessToken,
      user_id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    };

    // Encrypt session
    const sessionToken = encryptSession(sessionData);

    // Set session cookie and redirect to home
    const thirtyDays = 30 * 24 * 60 * 60;

    return redirectResponse(
      SITE_URL,
      [
        `wiki_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=${thirtyDays}; Path=/`,
        `oauth_state=; HttpOnly; Secure; Max-Age=0; Path=/`, // Clear state cookie
      ],
      'no-cache'
    );
  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirectResponse(
      `${SITE_URL}/#/login?error=${encodeURIComponent('Authentication failed')}`
    );
  }
};

export { handler };
