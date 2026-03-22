/**
 * MetricsService — orchestrates all collectors, caches results,
 * persists snapshots, and provides aggregated views.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  Config,
  MetricsConfig,
  MetricsSnapshot,
  ProjectHealth,
  InfraOverview,
  HealthStatus,
  createEmptySnapshot,
} from '../types/index.js';
import { IndexService } from './indexService.js';
import { GitHubCollector } from './collectors/githubCollector.js';
import { NetlifyCollector } from './collectors/netlifyCollector.js';
import { CloudflareCollector } from './collectors/cloudflareCollector.js';
import { GcpCollector } from './collectors/gcpCollector.js';
import { SupabaseCollector } from './collectors/supabaseCollector.js';
import { N8nCollector } from './collectors/n8nCollector.js';
import { logger } from '../utils/logger.js';

export class MetricsService {
  private config: Config;
  private metricsConfig: MetricsConfig;
  private indexService: IndexService;
  private metricsDir: string;

  private currentSnapshot: MetricsSnapshot | null = null;
  private lastCollectionTime = 0;
  private ttlMs: number;
  private collectionInterval: ReturnType<typeof setInterval> | null = null;
  private isCollecting = false;

  // Collectors — null if credentials not configured
  private githubCollector: GitHubCollector | null = null;
  private netlifyCollector: NetlifyCollector | null = null;
  private cloudflareCollector: CloudflareCollector | null = null;
  private gcpCollector: GcpCollector | null = null;
  private supabaseCollector: SupabaseCollector | null = null;
  private n8nCollector: N8nCollector | null = null;

  constructor(
    config: Config,
    metricsConfig: MetricsConfig,
    indexService: IndexService,
    metricsDir: string
  ) {
    this.config = config;
    this.metricsConfig = metricsConfig;
    this.indexService = indexService;
    this.metricsDir = metricsDir;
    this.ttlMs = (metricsConfig.metricsTtlMinutes || 60) * 60 * 1000;

    // Initialize collectors based on available credentials
    if (config.githubToken && config.githubUsername) {
      this.githubCollector = new GitHubCollector(config);
      logger.info('MetricsService', 'GitHub collector enabled');
    }

    if (metricsConfig.netlifyAccessToken) {
      this.netlifyCollector = new NetlifyCollector(metricsConfig);
      logger.info('MetricsService', 'Netlify collector enabled');
    }

    if (metricsConfig.cloudflareApiToken && metricsConfig.cloudflareAccountId) {
      this.cloudflareCollector = new CloudflareCollector(metricsConfig);
      logger.info('MetricsService', 'Cloudflare collector enabled');
    }

    if (metricsConfig.gcpServiceAccountKeyPath) {
      this.gcpCollector = new GcpCollector(metricsConfig);
      logger.info('MetricsService', 'GCP collector enabled');
    }

    if (metricsConfig.supabaseAccessToken && metricsConfig.supabaseProjectRefs.length > 0) {
      this.supabaseCollector = new SupabaseCollector(metricsConfig);
      logger.info('MetricsService', 'Supabase collector enabled');
    }

    if (metricsConfig.n8nApiUrl && metricsConfig.n8nApiKey) {
      this.n8nCollector = new N8nCollector(metricsConfig);
      logger.info('MetricsService', 'n8n collector enabled');
    }
  }

  async collectAll(): Promise<MetricsSnapshot> {
    if (this.isCollecting) {
      logger.info('MetricsService', 'Collection already in progress, returning cached');
      return this.currentSnapshot || createEmptySnapshot();
    }

    this.isCollecting = true;
    const snapshot = createEmptySnapshot();

    try {
      const collectors = [
        { name: 'github', collector: this.githubCollector },
        { name: 'netlify', collector: this.netlifyCollector },
        { name: 'cloudflare', collector: this.cloudflareCollector },
        { name: 'gcp', collector: this.gcpCollector },
        { name: 'supabase', collector: this.supabaseCollector },
        { name: 'n8n', collector: this.n8nCollector },
      ].filter(c => c.collector !== null);

      const results = await Promise.allSettled(
        collectors.map(async ({ name, collector }) => {
          const data = await collector!.collect();
          return { name, data };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.data) {
          const { name, data } = result.value;
          (snapshot.sources as Record<string, unknown>)[name] = data;
        }
      }

      snapshot.collectedAt = new Date().toISOString();
      this.currentSnapshot = snapshot;
      this.lastCollectionTime = Date.now();

      // Persist to disk
      await this.saveSnapshot(snapshot);

      logger.info('MetricsService', `Collection complete. Sources: ${Object.keys(snapshot.sources).join(', ')}`);
    } catch (error) {
      logger.error('MetricsService', 'Collection failed', error);
    } finally {
      this.isCollecting = false;
    }

    return snapshot;
  }

  async getSnapshot(): Promise<MetricsSnapshot> {
    // Return cached if within TTL
    if (this.currentSnapshot && (Date.now() - this.lastCollectionTime) < this.ttlMs) {
      return this.currentSnapshot;
    }

    // Try loading from disk
    if (!this.currentSnapshot) {
      const loaded = await this.loadLatestSnapshot();
      if (loaded) {
        this.currentSnapshot = loaded;
        this.lastCollectionTime = new Date(loaded.collectedAt).getTime();

        // If loaded snapshot is within TTL, return it
        if ((Date.now() - this.lastCollectionTime) < this.ttlMs) {
          return loaded;
        }
      }
    }

    // Trigger background collection and return what we have
    this.collectAll().catch(err => {
      logger.error('MetricsService', 'Background collection failed', err);
    });

    return this.currentSnapshot || createEmptySnapshot();
  }

  async getProjectHealth(projectName?: string): Promise<ProjectHealth[]> {
    const snapshot = await this.getSnapshot();
    const repos = this.indexService.getAllRepos();
    const healthList: ProjectHealth[] = [];

    for (const repo of repos) {
      if (projectName && repo.name !== projectName) continue;

      const githubRepo = snapshot.sources.github?.repos.find(r => r.name === repo.name);
      const netlifySite = this.findNetlifySite(repo.name, repo.remoteUrl, snapshot);

      // Convention checks
      const conventions = await this.checkConventions(repo.path);

      // Determine deploy status
      let deployStatus: HealthStatus = 'unknown';
      let deployPlatform = '';
      let lastDeployDate = '';
      let deploySuccessRate = 0;

      if (netlifySite) {
        deployPlatform = 'netlify';
        deploySuccessRate = netlifySite.deploySuccessRate;
        if (netlifySite.lastDeploy) {
          lastDeployDate = netlifySite.lastDeploy.createdAt;
          deployStatus = netlifySite.lastDeploy.state === 'ready' ? 'healthy' :
                         netlifySite.lastDeploy.state === 'error' ? 'error' : 'warning';
        }
      }

      // Actions status
      let actionsStatus: HealthStatus = 'unknown';
      if (githubRepo && githubRepo.workflows.length > 0) {
        const hasFailure = githubRepo.workflows.some(w => w.conclusion === 'failure');
        const allSuccess = githubRepo.workflows.every(
          w => w.conclusion === 'success' || w.conclusion === 'skipped'
        );
        actionsStatus = hasFailure ? 'error' : allSuccess ? 'healthy' : 'warning';
      }

      // Traffic level
      let trafficLevel: ProjectHealth['trafficLevel'] = 'none';
      if (githubRepo?.traffic) {
        const views = githubRepo.traffic.views;
        trafficLevel = views > 100 ? 'high' : views > 20 ? 'medium' : views > 0 ? 'low' : 'none';
      }

      healthList.push({
        name: repo.name,
        lastCommitDate: githubRepo?.lastCommitDate || repo.lastCommitDate,
        commitCount30d: githubRepo?.commits30d || 0,
        deployStatus,
        deployPlatform,
        lastDeployDate,
        deploySuccessRate,
        actionsStatus,
        trafficLevel,
        conventions,
      });
    }

    // Sort: projects with issues first, then by last commit date
    healthList.sort((a, b) => {
      const aIssue = a.deployStatus === 'error' || a.actionsStatus === 'error' ? 0 : 1;
      const bIssue = b.deployStatus === 'error' || b.actionsStatus === 'error' ? 0 : 1;
      if (aIssue !== bIssue) return aIssue - bIssue;
      return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
    });

    return healthList;
  }

  getDeployStatus(project?: string, platform?: string): object {
    const snapshot = this.currentSnapshot || createEmptySnapshot();
    const result: Record<string, unknown> = {};

    if (!platform || platform === 'netlify') {
      const sites = snapshot.sources.netlify?.sites || [];
      const filtered = project
        ? sites.filter(s => s.siteName.includes(project.toLowerCase()))
        : sites;
      result.netlify = filtered;
    }

    if (!platform || platform === 'cloudflare') {
      result.cloudflare = snapshot.sources.cloudflare?.workers || [];
    }

    if (!platform || platform === 'gcp') {
      result.gcp = snapshot.sources.gcp || { cloudRun: [], computeEngine: [] };
    }

    return result;
  }

  getInfraOverview(): InfraOverview {
    const snapshot = this.currentSnapshot || createEmptySnapshot();
    const repos = this.indexService.getAllRepos();

    // Netlify aggregation
    const sites = snapshot.sources.netlify?.sites || [];
    const totalDeploys = sites.reduce((sum, s) => sum + s.deploysLast30d, 0);
    const avgDeployRate = sites.length > 0
      ? sites.reduce((sum, s) => sum + s.deploySuccessRate, 0) / sites.length
      : 0;

    // n8n health
    const n8n = snapshot.sources.n8n;
    let n8nHealth: HealthStatus = 'unknown';
    if (n8n) {
      n8nHealth = n8n.successRate > 0.9 ? 'healthy' :
                  n8n.successRate > 0.7 ? 'warning' : 'error';
    }

    // GCP VM status
    const gcp = snapshot.sources.gcp;
    let gcpVmStatus: HealthStatus = 'unknown';
    if (gcp && gcp.computeEngine.length > 0) {
      const vm = gcp.computeEngine[0];
      gcpVmStatus = vm.status === 'RUNNING' ? 'healthy' : 'error';
    }

    // Top error projects (failed deploys)
    const errorProjects = sites
      .filter(s => s.lastDeploy?.state === 'error')
      .map(s => ({ name: s.siteName, errorCount: s.deploysLast30d - Math.round(s.deploysLast30d * s.deploySuccessRate) }))
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, 5);

    // Stalest projects
    const now = Date.now();
    const staleProjects = repos
      .map(r => ({
        name: r.name,
        daysSinceCommit: Math.round((now - new Date(r.lastCommitDate).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.daysSinceCommit - a.daysSinceCommit)
      .slice(0, 5);

    return {
      collectedAt: snapshot.collectedAt,
      totalProjects: repos.length,
      deployedProjects: sites.length,
      totalDeploys30d: totalDeploys,
      deploySuccessRate: Math.round(avgDeployRate * 100) / 100,
      n8nHealth,
      n8nWorkflowCount: n8n?.workflows.length || 0,
      n8nSuccessRate: n8n?.successRate || 0,
      gcpVmStatus,
      topErrorProjects: errorProjects,
      stalestProjects: staleProjects,
    };
  }

  startBackgroundCollection(): void {
    const intervalMs = (this.metricsConfig.metricsCollectionIntervalMinutes || 360) * 60 * 1000;

    // Initial collection after 60 seconds (let index build first)
    setTimeout(() => {
      this.collectAll().catch(err => {
        logger.error('MetricsService', 'Initial collection failed', err);
      });
    }, 60_000);

    // Periodic collection
    this.collectionInterval = setInterval(() => {
      this.collectAll().catch(err => {
        logger.error('MetricsService', 'Periodic collection failed', err);
      });
    }, intervalMs);

    logger.info('MetricsService', `Background collection scheduled every ${this.metricsConfig.metricsCollectionIntervalMinutes} minutes`);
  }

  stopBackgroundCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.info('MetricsService', 'Background collection stopped');
    }
  }

  // --- Private helpers ---

  private findNetlifySite(
    repoName: string,
    remoteUrl: string | undefined,
    snapshot: MetricsSnapshot
  ) {
    const sites = snapshot.sources.netlify?.sites || [];

    // Match by repo URL
    if (remoteUrl) {
      const normalized = remoteUrl.replace(/\.git$/, '').toLowerCase();
      const match = sites.find(s =>
        s.repoUrl && s.repoUrl.replace(/\.git$/, '').toLowerCase() === normalized
      );
      if (match) return match;
    }

    // Fallback: match by name similarity
    const lowerName = repoName.toLowerCase();
    return sites.find(s => s.siteName.toLowerCase().includes(lowerName));
  }

  private async checkConventions(repoPath: string): Promise<ProjectHealth['conventions']> {
    const check = async (file: string): Promise<boolean> => {
      try {
        await fs.access(path.join(repoPath, file));
        return true;
      } catch {
        return false;
      }
    };

    const [hasClaudeMd, hasEnvExample, hasGitignore, hasNetlifyToml] = await Promise.all([
      check('CLAUDE.md'),
      check('.env.example'),
      check('.gitignore'),
      check('netlify.toml'),
    ]);

    return { hasClaudeMd, hasEnvExample, hasGitignore, hasNetlifyToml };
  }

  private async saveSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    try {
      await fs.mkdir(this.metricsDir, { recursive: true });

      // Save dated snapshot
      const date = new Date().toISOString().split('T')[0];
      const datedPath = path.join(this.metricsDir, `metrics-${date}.json`);
      await fs.writeFile(datedPath, JSON.stringify(snapshot, null, 2), 'utf-8');

      // Save latest.json for quick access
      const latestPath = path.join(this.metricsDir, 'latest.json');
      await fs.writeFile(latestPath, JSON.stringify(snapshot, null, 2), 'utf-8');

      logger.info('MetricsService', `Snapshot saved to ${datedPath}`);
    } catch (error) {
      logger.error('MetricsService', 'Failed to save snapshot', error);
    }
  }

  private async loadLatestSnapshot(): Promise<MetricsSnapshot | null> {
    try {
      const latestPath = path.join(this.metricsDir, 'latest.json');
      const content = await fs.readFile(latestPath, 'utf-8');
      return JSON.parse(content) as MetricsSnapshot;
    } catch {
      return null;
    }
  }
}
