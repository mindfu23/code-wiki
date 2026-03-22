/**
 * Cloudflare metrics collector.
 * Fetches Workers analytics via Cloudflare GraphQL API.
 */

import { BaseCollector } from './baseCollector.js';
import { MetricsConfig, CloudflareMetrics, CloudflareWorkerMetrics } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

export class CloudflareCollector extends BaseCollector<CloudflareMetrics> {
  private token: string;
  private accountId: string;

  constructor(metricsConfig: MetricsConfig) {
    super('CloudflareCollector');
    this.token = metricsConfig.cloudflareApiToken!;
    this.accountId = metricsConfig.cloudflareAccountId!;
  }

  protected async doCollect(): Promise<CloudflareMetrics> {
    const scripts = await this.fetchWorkerScripts();
    const workers: CloudflareWorkerMetrics[] = [];

    for (const scriptName of scripts) {
      const analytics = await this.fetchWorkerAnalytics(scriptName);
      if (analytics) workers.push(analytics);
    }

    return {
      collectedAt: new Date().toISOString(),
      workers,
    };
  }

  private async fetchWorkerScripts(): Promise<string[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        throw new Error(`Cloudflare scripts API error: ${response.status}`);
      }

      const data = await response.json() as { result: { id: string }[] };
      return data.result.map(s => s.id);
    }, 'Cloudflare scripts');
  }

  private async fetchWorkerAnalytics(scriptName: string): Promise<CloudflareWorkerMetrics | null> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      return await globalRateLimiter.withBackoff(async () => {
        const query = `
          query {
            viewer {
              accounts(filter: {accountTag: "${this.accountId}"}) {
                workersInvocationsAdaptive(
                  filter: {scriptName: "${scriptName}", datetime_gt: "${since}"}
                  limit: 1000
                ) {
                  sum {
                    requests
                    errors
                  }
                  quantiles {
                    cpuTimeP50
                    cpuTimeP99
                  }
                }
              }
            }
          }
        `;

        const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            ...this.headers(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) {
          logger.warn('CloudflareCollector', `Analytics query failed for ${scriptName}: ${response.status}`);
          return null;
        }

        const data = await response.json() as {
          data: {
            viewer: {
              accounts: [{
                workersInvocationsAdaptive: [{
                  sum: { requests: number; errors: number };
                  quantiles: { cpuTimeP50: number; cpuTimeP99: number };
                }];
              }];
            };
          };
        };

        const invocations = data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0];
        if (!invocations) {
          return { scriptName, requests: 0, errors: 0, p50LatencyMs: 0, p99LatencyMs: 0 };
        }

        return {
          scriptName,
          requests: invocations.sum.requests,
          errors: invocations.sum.errors,
          p50LatencyMs: Math.round(invocations.quantiles.cpuTimeP50 / 1000),
          p99LatencyMs: Math.round(invocations.quantiles.cpuTimeP99 / 1000),
        };
      }, 'Cloudflare analytics');
    } catch {
      return null;
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }
}
