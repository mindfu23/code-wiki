/**
 * Netlify Sites API function for Code Wiki
 * Fetches all Netlify sites for the authenticated user
 * Requires NETLIFY_ACCESS_TOKEN environment variable
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  build_settings?: {
    repo_url?: string;
  };
  updated_at: string;
}

interface SimplifiedSite {
  id: string;
  name: string;
  url: string;
  adminUrl: string;
  repoUrl?: string;
  updatedAt: string;
}

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Check for API token
  const token = process.env.NETLIFY_ACCESS_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Netlify API token not configured',
        message: 'Add NETLIFY_ACCESS_TOKEN to Netlify environment variables'
      }),
    };
  }

  try {
    // Fetch sites from Netlify API
    const response = await fetch('https://api.netlify.com/api/v1/sites', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Netlify API error:', response.status, errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to fetch Netlify sites',
          status: response.status,
        }),
      };
    }

    const sites: NetlifySite[] = await response.json();

    // Simplify the response - only include relevant fields
    const simplifiedSites: SimplifiedSite[] = sites.map(site => ({
      id: site.id,
      name: site.name,
      url: site.ssl_url || site.url,
      adminUrl: site.admin_url,
      repoUrl: site.build_settings?.repo_url,
      updatedAt: site.updated_at,
    }));

    // Sort by name
    simplifiedSites.sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          sites: simplifiedSites,
          total: simplifiedSites.length,
        },
      }),
    };
  } catch (error) {
    console.error('Error fetching Netlify sites:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch Netlify sites',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

export { handler };
