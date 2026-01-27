/**
 * sync_repos tool implementation
 */

import { SyncService } from '../services/syncService.js';

export const syncReposTool = {
  name: 'sync_repos',
  description: 'Manually trigger GitHub sync to pull updates and clone new repositories. Requires GITHUB_TOKEN to be configured.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      force: {
        type: 'boolean',
        description: 'Force pull all repos even if they appear up-to-date',
      },
    },
  },
};

export async function handleSyncRepos(
  args: { force?: boolean },
  syncService: SyncService
): Promise<string> {
  if (syncService.isSyncInProgress()) {
    return JSON.stringify({
      status: 'in_progress',
      message: 'A sync operation is already in progress. Please wait for it to complete.',
    }, null, 2);
  }

  const report = await syncService.syncNow(args.force || false);

  return JSON.stringify({
    status: 'completed',
    checkedAt: report.checkedAt,
    summary: {
      reposChecked: report.reposChecked,
      reposPulled: report.reposPulled,
      reposCloned: report.reposCloned,
      errorCount: report.errors.length,
    },
    errors: report.errors.length > 0 ? report.errors : undefined,
    lastSyncTime: syncService.getLastSyncTime(),
  }, null, 2);
}
