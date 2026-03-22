/**
 * Netlify metrics collector.
 * Fetches site list and deploy history from Netlify API.
 */

import { BaseCollector } from './baseCollector.js';
import { MetricsConfig, NetlifyMetrics, NetlifySiteMetrics } from '../../types/index.js';
import { globalRateLimiter } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';

interface NetlifyApiSite {
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

interface NetlifyApiDeploy {
  id: string;
  state: string;
  created_at: string;
  deploy_time: number | null;
  error_message: string | null;
}

export class NetlifyCollector extends BaseCollector<NetlifyMetrics> {
  private token: string;

  constructor(metricsConfig: MetricsConfig) {
    super('NetlifyCollector');
    this.token = metricsConfig.netlifyAccessToken!;
  }

  protected async doCollect(): Promise<NetlifyMetrics> {
    const sites = await this.fetchSites();
    const siteMetrics: NetlifySiteMetrics[] = [];

    // Process in batches of 5
    for (let i = 0; i < sites.length; i += 5) {
      const batch = sites.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(site => this.collectSiteMetrics(site))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          siteMetrics.push(result.value);
        }
      }
    }

    return {
      collectedAt: new Date().toISOString(),
      sites: siteMetrics,
    };
  }

  private async fetchSites(): Promise<NetlifyApiSite[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch('https://api.netlify.com/api/v1/sites', {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Netlify sites API error: ${response.status}`);
      }

      return response.json() as Promise<NetlifyApiSite[]>;
    }, 'Netlify sites');
  }

  private async collectSiteMetrics(site: NetlifyApiSite): Promise<NetlifySiteMetrics> {
    const deploys = await this.fetchDeploys(site.id);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentDeploys = deploys.filter(
      d => new Date(d.created_at).getTime() > thirtyDaysAgo
    );

    const successCount = recentDeploys.filter(d => d.state === 'ready').length;
    const deploySuccessRate = recentDeploys.length > 0
      ? successCount / recentDeploys.length
      : 1;

    const latestDeploy = deploys[0] || null;

    return {
      siteId: site.id,
      siteName: site.name,
      url: site.ssl_url || site.url,
      repoUrl: site.build_settings?.repo_url,
      lastDeploy: latestDeploy
        ? {
            id: latestDeploy.id,
            state: latestDeploy.state,
            createdAt: latestDeploy.created_at,
            deployTimeSeconds: latestDeploy.deploy_time || 0,
            errorMessage: latestDeploy.error_message || undefined,
          }
        : null,
      deploysLast30d: recentDeploys.length,
      deploySuccessRate: Math.round(deploySuccessRate * 100) / 100,
    };
  }

  private async fetchDeploys(siteId: string): Promise<NetlifyApiDeploy[]> {
    return globalRateLimiter.withBackoff(async () => {
      const response = await fetch(
        `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=30`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        logger.warn('NetlifyCollector', `Failed to fetch deploys for site ${siteId}: ${response.status}`);
        return [];
      }

      return response.json() as Promise<NetlifyApiDeploy[]>;
    }, 'Netlify deploys');
  }
}
