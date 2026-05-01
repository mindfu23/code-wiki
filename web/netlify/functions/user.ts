/**
 * User API - Returns current authenticated user info.
 * Reads and decrypts the session cookie via the shared auth helper.
 */

import { Handler, HandlerEvent } from '@netlify/functions';
import { getAccessLevel } from './_shared/auth.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const access = getAccessLevel(event);
  if (!access.session) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Not authenticated' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      user: {
        id: access.session.user_id ?? null,
        login: access.session.login,
        name: access.session.name ?? null,
        email: access.session.email ?? null,
        avatar_url: access.session.avatar_url ?? '',
        kind: access.session.kind ?? 'owner',
      },
      access: {
        canReadPrivate: access.canReadPrivate,
        canWrite: access.canWrite,
        canAdmin: access.canAdmin,
      },
    }),
  };
};

export { handler };
