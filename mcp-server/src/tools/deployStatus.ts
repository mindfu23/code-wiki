/**
 * deploy_status MCP tool — returns deployment info from Netlify/Cloudflare/GCP
 */

import { MetricsService } from '../services/metricsService.js';

export const deployStatusTool = {
  name: 'deploy_status',
  description: 'Get latest deployment info from Netlify, Cloudflare, or GCP Cloud Run. Filter by project name or platform.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string',
        description: 'Filter to a specific project name',
      },
      platform: {
        type: 'string',
        enum: ['netlify', 'cloudflare', 'gcp'],
        description: 'Filter by deployment platform',
      },
    },
  },
};

export async function handleDeployStatus(
  args: { project?: string; platform?: string },
  metricsService: MetricsService
): Promise<string> {
  const status = metricsService.getDeployStatus(args.project, args.platform);
  return JSON.stringify(status, null, 2);
}
