/**
 * n8n metrics collector.
 * Fetches workflow list and execution history from the n8n REST API.
 */

import { BaseCollector } from './baseCollector.js';
import { MetricsConfig, N8nMetrics, N8nWorkflowMetrics } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

interface N8nApiWorkflow {
  id: string;
  name: string;
  active: boolean;
}

interface N8nApiExecution {
  id: string;
  finished: boolean;
  status: string;
  startedAt: string;
  stoppedAt: string;
  workflowId: string;
}

export class N8nCollector extends BaseCollector<N8nMetrics> {
  private apiUrl: string;
  private apiKey: string;

  constructor(metricsConfig: MetricsConfig) {
    super('N8nCollector');
    this.apiUrl = metricsConfig.n8nApiUrl!.replace(/\/$/, '');
    this.apiKey = metricsConfig.n8nApiKey!;
  }

  protected async doCollect(): Promise<N8nMetrics> {
    const workflows = await this.fetchWorkflows();
    const workflowMetrics: N8nWorkflowMetrics[] = [];
    let totalExecs = 0;
    let totalSuccess = 0;

    for (const wf of workflows) {
      const executions = await this.fetchExecutions(wf.id);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recent = executions.filter(e => new Date(e.startedAt).getTime() > thirtyDaysAgo);

      const successCount = recent.filter(e => e.status === 'success').length;
      const failureCount = recent.filter(e => e.status === 'error' || e.status === 'failed').length;

      const durations = recent
        .filter(e => e.stoppedAt)
        .map(e => (new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()) / 1000);
      const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

      const latest = recent[0];
      totalExecs += recent.length;
      totalSuccess += successCount;

      workflowMetrics.push({
        id: wf.id,
        name: wf.name,
        active: wf.active,
        executionsLast30d: recent.length,
        successCount,
        failureCount,
        avgDurationSeconds: avgDuration,
        lastExecution: latest
          ? {
              id: latest.id,
              status: latest.status,
              startedAt: latest.startedAt,
              finishedAt: latest.stoppedAt,
            }
          : undefined,
      });
    }

    return {
      collectedAt: new Date().toISOString(),
      workflows: workflowMetrics,
      totalExecutions: totalExecs,
      successRate: totalExecs > 0 ? Math.round((totalSuccess / totalExecs) * 100) / 100 : 0,
    };
  }

  private async fetchWorkflows(): Promise<N8nApiWorkflow[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(`${this.apiUrl}/api/v1/workflows`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        throw new Error(`n8n workflows API error: ${response.status}`);
      }

      const data = await response.json() as { data: N8nApiWorkflow[] };
      return data.data || [];
    }, 'n8n workflows');
  }

  private async fetchExecutions(workflowId: string): Promise<N8nApiExecution[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `${this.apiUrl}/api/v1/executions?workflowId=${workflowId}&limit=100`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        logger.warn('N8nCollector', `Executions fetch failed for workflow ${workflowId}: ${response.status}`);
        return [];
      }

      const data = await response.json() as { data: N8nApiExecution[] };
      return data.data || [];
    }, 'n8n executions');
  }

  private headers(): Record<string, string> {
    return {
      'X-N8N-API-KEY': this.apiKey,
      Accept: 'application/json',
    };
  }
}
