/**
 * project_health MCP tool — returns health status for projects
 */

import { MetricsService } from '../services/metricsService.js';
import { Config } from '../types/config.js';
import { loadProjectStatus, statusFor } from '../utils/projectStatus.js';

export const projectHealthTool = {
  name: 'project_health',
  description: 'Get health status for projects including last commit, deploy status, CI/CD status, traffic level, and convention compliance (CLAUDE.md, .env.example, .gitignore, netlify.toml), and lifecycle status from the project-status registry (dormant = paused, not maintained). Returns all projects if no project name specified.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string',
        description: 'Filter to a specific project name. If omitted, returns all projects.',
      },
    },
  },
};

export async function handleProjectHealth(
  args: { project?: string },
  metricsService: MetricsService,
  config?: Pick<Config, 'wikiDirectory' | 'privateWikiDirectory'>
): Promise<string> {
  const status = config ? loadProjectStatus(config) : new Map();
  const health = (await metricsService.getProjectHealth(args.project)).map(p => {
    const s = statusFor(status, p.name);
    return s ? { ...p, status: s } : p;
  });

  if (health.length === 0) {
    return JSON.stringify({
      message: args.project
        ? `No project found matching "${args.project}"`
        : 'No projects indexed yet',
      suggestions: ['Run sync_repos to update the index', 'Check SOURCE_DIRS configuration'],
    }, null, 2);
  }

  // Summary stats
  const errorCount = health.filter(p =>
    p.deployStatus === 'error' || p.actionsStatus === 'error'
  ).length;
  const conventionIssues = health.filter(p => {
    const c = p.conventions;
    return !c.hasClaudeMd || !c.hasEnvExample || !c.hasGitignore;
  }).length;

  return JSON.stringify({
    summary: {
      totalProjects: health.length,
      projectsWithErrors: errorCount,
      projectsWithConventionIssues: conventionIssues,
    },
    projects: health,
  }, null, 2);
}
