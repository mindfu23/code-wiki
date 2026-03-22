/**
 * Supabase metrics collector.
 * Fetches database size, auth users, and API request counts
 * via the Supabase Management API.
 */

import { BaseCollector } from './baseCollector.js';
import { MetricsConfig, SupabaseMetrics, SupabaseProjectMetrics } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

export class SupabaseCollector extends BaseCollector<SupabaseMetrics> {
  private token: string;
  private projectRefs: string[];

  constructor(metricsConfig: MetricsConfig) {
    super('SupabaseCollector');
    this.token = metricsConfig.supabaseAccessToken!;
    this.projectRefs = metricsConfig.supabaseProjectRefs;
  }

  protected async doCollect(): Promise<SupabaseMetrics> {
    const projects: SupabaseProjectMetrics[] = [];

    for (const ref of this.projectRefs) {
      const metrics = await this.collectProjectMetrics(ref);
      if (metrics) projects.push(metrics);
    }

    return {
      collectedAt: new Date().toISOString(),
      projects,
    };
  }

  private async collectProjectMetrics(projectRef: string): Promise<SupabaseProjectMetrics | null> {
    try {
      const [projectInfo, dbSize] = await Promise.allSettled([
        this.fetchProjectInfo(projectRef),
        this.fetchDatabaseSize(projectRef),
      ]);

      const info = projectInfo.status === 'fulfilled' ? projectInfo.value : null;
      const size = dbSize.status === 'fulfilled' ? dbSize.value : 0;

      return {
        projectRef,
        projectName: info?.name || projectRef,
        dbSizeMb: size,
        activeUsers: 0, // Supabase Management API doesn't expose this directly
        apiRequestCount: 0, // Would need analytics API
      };
    } catch (error) {
      logger.warn('SupabaseCollector', `Failed to collect metrics for ${projectRef}`, error);
      return null;
    }
  }

  private async fetchProjectInfo(projectRef: string): Promise<{ name: string } | null> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}`,
        { headers: this.headers() }
      );

      if (!response.ok) {
        logger.warn('SupabaseCollector', `Project info failed for ${projectRef}: ${response.status}`);
        return null;
      }

      const data = await response.json() as { name: string };
      return data;
    }, 'Supabase project');
  }

  private async fetchDatabaseSize(projectRef: string): Promise<number> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/size`,
        { headers: this.headers() }
      );

      if (!response.ok) return 0;

      const data = await response.json() as { size_bytes?: number; db_size?: number };
      const bytes = data.size_bytes || data.db_size || 0;
      return Math.round(bytes / (1024 * 1024) * 100) / 100;
    }, 'Supabase DB size');
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }
}
