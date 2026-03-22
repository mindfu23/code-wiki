/**
 * infra_overview MCP tool — returns aggregated infrastructure health
 */

import { MetricsService } from '../services/metricsService.js';

export const infraOverviewTool = {
  name: 'infra_overview',
  description: 'Get aggregated infrastructure overview: total deploys, error rates, n8n workflow health, GCP VM status, stalest projects, and top error projects.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handleInfraOverview(
  _args: Record<string, never>,
  metricsService: MetricsService
): Promise<string> {
  const overview = metricsService.getInfraOverview();
  return JSON.stringify(overview, null, 2);
}
