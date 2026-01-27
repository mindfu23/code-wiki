/**
 * Repository and sync-related types
 */

export interface GitStatus {
  ahead: number;
  behind: number;
  hasChanges: boolean;
  currentBranch: string;
}

export interface SyncState {
  repos: Record<string, RepoSyncState>;
  lastFullSync: string; // ISO timestamp
  lastApiCall: string; // ISO timestamp
}

export interface RepoSyncState {
  name: string;
  path: string;
  lastPull: string; // ISO timestamp
  lastCommitSha: string;
  syncStatus: 'synced' | 'behind' | 'error' | 'new';
  errorMessage?: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  pushed_at: string;
  default_branch: string;
  private: boolean;
  description?: string;
  language?: string;
}

export interface SyncReport {
  checkedAt: string;
  reposChecked: number;
  reposPulled: number;
  reposCloned: number;
  errors: SyncError[];
}

export interface SyncError {
  repo: string;
  error: string;
}

export interface PullResult {
  success: boolean;
  updated: boolean;
  message: string;
}

export interface CloneResult {
  success: boolean;
  path: string;
  message: string;
}

export function createEmptySyncState(): SyncState {
  return {
    repos: {},
    lastFullSync: '',
    lastApiCall: '',
  };
}
