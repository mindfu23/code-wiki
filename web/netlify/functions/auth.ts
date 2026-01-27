/**
 * Auth API function for Code Wiki
 * Handles logout and auth status
 * Login/signup handled via GitHub OAuth (oauth-login.ts, oauth-callback.ts)
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

const SITE_URL = process.env.URL || process.env.SITE_URL || 'http://localhost:8888';

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

interface AuthRequest {
  action: 'logout' | 'status';
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Parse request
  let request: AuthRequest = { action: 'status' };
  try {
    if (event.httpMethod === 'POST' && event.body) {
      request = JSON.parse(event.body);
    } else {
      const params = event.queryStringParameters || {};
      request = { action: (params.action as AuthRequest['action']) || 'status' };
    }
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request body' }),
    };
  }

  // Handle logout
  if (request.action === 'logout') {
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Set-Cookie': 'wiki_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      },
      body: JSON.stringify({ success: true, message: 'Logged out' }),
    };
  }

  // Handle status check - redirect to /user endpoint
  if (request.action === 'status') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Use /.netlify/functions/user to check authentication status',
        loginUrl: '/.netlify/functions/oauth-login',
      }),
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ error: `Unknown action: ${request.action}` }),
  };
};

export { handler };
