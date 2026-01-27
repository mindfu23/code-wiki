/**
 * Index and cache data structure types
 */

export const CURRENT_INDEX_VERSION = '1.0.0';

export interface RepoIndex {
  repos: RepoMetadata[];
  wikiDocuments: WikiDocument[];
  lastFullIndex: string; // ISO timestamp
  version: string; // Index schema version
}

export interface RepoMetadata {
  name: string;
  path: string;
  remoteUrl?: string;
  lastCommit: string; // Commit SHA
  lastCommitDate: string; // ISO timestamp
  lastIndexed: string; // ISO timestamp
  languages: string[]; // Detected languages
  fileCount: number;
  hasReadme: boolean;
  description?: string; // From README first line or package.json
}

export interface FileMetadata {
  path: string;
  relativePath: string;
  repoName: string;
  language: string;
  size: number;
  lastModified: string;
}

export interface WikiDocument {
  path: string;
  relativePath: string;
  category: string; // patterns, utilities, etc.
  frontmatter: WikiFrontmatter;
  contentPreview: string; // First 500 chars for search
  lastModified: string;
}

export interface WikiFrontmatter {
  title: string;
  tags: string[];
  language?: string;
  updated?: string;
  source_repo?: string;
  description?: string;
}

export function createEmptyIndex(): RepoIndex {
  return {
    repos: [],
    wikiDocuments: [],
    lastFullIndex: new Date().toISOString(),
    version: CURRENT_INDEX_VERSION,
  };
}
