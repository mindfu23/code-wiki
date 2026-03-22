/**
 * GCP metrics collector.
 * Fetches Cloud Run and Compute Engine metrics via GCP Monitoring API.
 * Uses service account key for JWT-based authentication (no npm dependency).
 */

import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { BaseCollector } from './baseCollector.js';
import { MetricsConfig, GcpMetrics, GcpCloudRunMetrics, GcpComputeMetrics } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export class GcpCollector extends BaseCollector<GcpMetrics> {
  private keyPath: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(metricsConfig: MetricsConfig) {
    super('GcpCollector');
    this.keyPath = metricsConfig.gcpServiceAccountKeyPath!;
  }

  protected async doCollect(): Promise<GcpMetrics> {
    const key = JSON.parse(await fs.readFile(this.keyPath, 'utf-8')) as ServiceAccountKey;
    await this.ensureAccessToken(key);

    const [cloudRun, computeEngine] = await Promise.allSettled([
      this.fetchCloudRunMetrics(key.project_id),
      this.fetchComputeMetrics(key.project_id),
    ]);

    return {
      collectedAt: new Date().toISOString(),
      cloudRun: cloudRun.status === 'fulfilled' ? cloudRun.value : [],
      computeEngine: computeEngine.status === 'fulfilled' ? computeEngine.value : [],
    };
  }

  private async ensureAccessToken(key: ServiceAccountKey): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) return;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/monitoring.read https://www.googleapis.com/auth/compute.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');

    const signInput = `${header}.${payload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signInput);
    const signature = signer.sign(key.private_key, 'base64url');

    const jwt = `${signInput}.${signature}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      throw new Error(`GCP auth failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
  }

  private async fetchCloudRunMetrics(projectId: string): Promise<GcpCloudRunMetrics[]> {
    return globalRateLimiter.withBackoff(async () => {
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const filter = encodeURIComponent(
        'metric.type = "run.googleapis.com/request_count" AND resource.type = "cloud_run_revision"'
      );

      const response = await fetch(
        `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?filter=${filter}&interval.startTime=${startTime}&interval.endTime=${endTime}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM`,
        { headers: this.authHeaders() }
      );

      if (!response.ok) {
        if (response.status === 403 || response.status === 404) return [];
        throw new Error(`GCP Monitoring API error: ${response.status}`);
      }

      const data = await response.json() as {
        timeSeries?: Array<{
          resource: { labels: { service_name: string; location: string } };
          points: Array<{ value: { int64Value?: string; doubleValue?: number } }>;
          metric: { labels: { response_code_class?: string } };
        }>;
      };

      if (!data.timeSeries) return [];

      // Group by service
      const byService = new Map<string, { requests: number; errors: number; region: string }>();
      for (const series of data.timeSeries) {
        const name = series.resource.labels.service_name;
        const region = series.resource.labels.location;
        const count = parseInt(series.points[0]?.value.int64Value || '0', 10);
        const isError = series.metric.labels.response_code_class === '5xx';

        const existing = byService.get(name) || { requests: 0, errors: 0, region };
        existing.requests += count;
        if (isError) existing.errors += count;
        byService.set(name, existing);
      }

      return Array.from(byService.entries()).map(([name, data]) => ({
        serviceName: name,
        region: data.region,
        requestCount: data.requests,
        errorRate: data.requests > 0 ? Math.round((data.errors / data.requests) * 100) / 100 : 0,
        p50LatencyMs: 0, // Would need separate latency metric query
      }));
    }, 'GCP Monitoring');
  }

  private async fetchComputeMetrics(projectId: string): Promise<GcpComputeMetrics[]> {
    return globalRateLimiter.withBackoff(async () => {
      // List instances
      const response = await fetch(
        `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/instances`,
        { headers: this.authHeaders() }
      );

      if (!response.ok) {
        if (response.status === 403) return [];
        throw new Error(`GCP Compute API error: ${response.status}`);
      }

      const data = await response.json() as {
        items: Record<string, {
          instances?: Array<{
            name: string;
            zone: string;
            status: string;
          }>;
        }>;
      };

      const instances: GcpComputeMetrics[] = [];
      for (const [, zoneData] of Object.entries(data.items || {})) {
        for (const instance of zoneData.instances || []) {
          instances.push({
            instanceName: instance.name,
            zone: instance.zone.split('/').pop() || '',
            status: instance.status,
            cpuUtilization: 0, // Would need Monitoring API time series query
            memoryUtilization: 0,
          });
        }
      }

      return instances;
    }, 'GCP Compute');
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }
}
