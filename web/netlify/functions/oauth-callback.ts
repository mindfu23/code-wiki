/**
 * OAuth Callback - Handles GitHub OAuth callback
 * Exchanges authorization code for access token and creates session
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import {
  encryptSession,
  parseCookies,
  buildSessionCookie,
  type Session,
} from './_shared/auth.js';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';

// Helper function for redirect responses with consistent typing
function redirectResponse(
  location: string,
  cookies?: string[],
  cacheControl?: string
): {
  statusCode: number;
  headers: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  body: string;
} {
  const headers: Record<string, string> = { Location: location };
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }

  // Use multiValueHeaders for multiple Set-Cookie headers
  if (cookies && cookies.length > 0) {
    return {
      statusCode: 302,
      headers,
      multiValueHeaders: { 'Set-Cookie': cookies },
      body: '',
    };
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
  const cookies = parseCookies(event.headers.cookie);
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
    const sessionData: Session = {
      access_token: accessToken,
      user_id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      // No `kind` set — getAccessLevel treats this as the OAuth path and decides
      // owner vs non-owner from login match against GITHUB_REPO_OWNER.
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    };

    console.log('OAuth callback: creating session for user', user.login);

    const sessionToken = encryptSession(sessionData);
    console.log('OAuth callback: session token created, length:', sessionToken.length);

    const thirtyDays = 30 * 24 * 60 * 60;
    console.log('OAuth callback: redirecting to', SITE_URL);

    return redirectResponse(
      SITE_URL,
      [
        buildSessionCookie(sessionToken, thirtyDays),
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
