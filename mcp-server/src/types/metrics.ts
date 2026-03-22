/**
 * Type definitions for the Observatory metrics module
 */

// --- Snapshot container ---

export interface MetricsSnapshot {
  collectedAt: string;
  version: string;
  sources: {
    github?: GitHubMetrics;
    netlify?: NetlifyMetrics;
    cloudflare?: CloudflareMetrics;
    gcp?: GcpMetrics;
    supabase?: SupabaseMetrics;
    n8n?: N8nMetrics;
  };
}

// --- GitHub ---

export interface GitHubMetrics {
  collectedAt: string;
  repos: GitHubRepoMetrics[];
}

export interface GitHubRepoMetrics {
  name: string;
  commits30d: number;
  lastCommitDate: string;
  openIssues: number;
  language: string | null;
  traffic?: { views: number; clones: number; uniqueVisitors: number };
  workflows: WorkflowRunSummary[];
}

export interface WorkflowRunSummary {
  name: string;
  workflowId: number;
  lastRun: string;
  conclusion: string;
  durationSeconds: number;
  runCount30d: number;
}

// --- Netlify ---

export interface NetlifyMetrics {
  collectedAt: string;
  sites: NetlifySiteMetrics[];
}

export interface NetlifySiteMetrics {
  siteId: string;
  siteName: string;
  url: string;
  repoUrl?: string;
  lastDeploy: {
    id: string;
    state: string;
    createdAt: string;
    deployTimeSeconds: number;
    errorMessage?: string;
  } | null;
  deploysLast30d: number;
  deploySuccessRate: number;
}

// --- Cloudflare ---

export interface CloudflareMetrics {
  collectedAt: string;
  workers: CloudflareWorkerMetrics[];
}

export interface CloudflareWorkerMetrics {
  scriptName: string;
  requests: number;
  errors: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
}

// --- GCP ---

export interface GcpMetrics {
  collectedAt: string;
  cloudRun: GcpCloudRunMetrics[];
  computeEngine: GcpComputeMetrics[];
}

export interface GcpCloudRunMetrics {
  serviceName: string;
  region: string;
  requestCount: number;
  errorRate: number;
  p50LatencyMs: number;
}

export interface GcpComputeMetrics {
  instanceName: string;
  zone: string;
  status: string;
  cpuUtilization: number;
  memoryUtilization: number;
}

// --- Supabase ---

export interface SupabaseMetrics {
  collectedAt: string;
  projects: SupabaseProjectMetrics[];
}

export interface SupabaseProjectMetrics {
  projectRef: string;
  projectName: string;
  dbSizeMb: number;
  activeUsers: number;
  apiRequestCount: number;
}

// --- n8n ---

export interface N8nMetrics {
  collectedAt: string;
  workflows: N8nWorkflowMetrics[];
  totalExecutions: number;
  successRate: number;
}

export interface N8nWorkflowMetrics {
  id: string;
  name: string;
  active: boolean;
  executionsLast30d: number;
  successCount: number;
  failureCount: number;
  avgDurationSeconds: number;
  lastExecution?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string;
  };
}

// --- Aggregated views ---

export type HealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';

export interface ProjectHealth {
  name: string;
  lastCommitDate: string;
  commitCount30d: number;
  deployStatus: HealthStatus;
  deployPlatform: string;
  lastDeployDate: string;
  deploySuccessRate: number;
  actionsStatus: HealthStatus;
  trafficLevel: 'high' | 'medium' | 'low' | 'none';
  conventions: {
    hasClaudeMd: boolean;
    hasEnvExample: boolean;
    hasGitignore: boolean;
    hasNetlifyToml: boolean;
  };
}

export interface InfraOverview {
  collectedAt: string;
  totalProjects: number;
  deployedProjects: number;
  totalDeploys30d: number;
  deploySuccessRate: number;
  n8nHealth: HealthStatus;
  n8nWorkflowCount: number;
  n8nSuccessRate: number;
  gcpVmStatus: HealthStatus;
  topErrorProjects: { name: string; errorCount: number }[];
  stalestProjects: { name: string; daysSinceCommit: number }[];
}

export function createEmptySnapshot(): MetricsSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    version: '1.0.0',
    sources: {},
  };
}
