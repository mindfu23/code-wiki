/**
 * project_health MCP tool — returns health status for projects
 */

import { MetricsService } from '../services/metricsService.js';

export const projectHealthTool = {
  name: 'project_health',
  description: 'Get health status for projects including last commit, deploy status, CI/CD status, traffic level, and convention compliance (CLAUDE.md, .env.example, .gitignore, netlify.toml). Returns all projects if no project name specified.',
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
  metricsService: MetricsService
): Promise<string> {
  const health = await metricsService.getProjectHealth(args.project);

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
