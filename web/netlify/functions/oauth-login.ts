/**
 * OAuth Login - Initiates GitHub OAuth flow
 * Redirects user to GitHub authorization page
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import * as crypto from 'crypto';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';

// Required scopes for committing to repo
const SCOPES = ['repo', 'user:email'].join(' ');

const handler: Handler = async (event: HandlerEvent) => {
  if (!GITHUB_CLIENT_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GitHub OAuth not configured' }),
    };
  }

  // Generate state token for CSRF protection
  const state = crypto.randomUUID();

  // Build redirect URL
  const redirectUri = `${SITE_URL}/.netlify/functions/oauth-callback`;

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);

  return {
    statusCode: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      'Cache-Control': 'no-cache',
    },
    body: '',
  };
};

export { handler };
