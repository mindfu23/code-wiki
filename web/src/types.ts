/**
 * Shared types for Code Wiki Web Interface
 */

export interface WikiDocument {
  path: string;
  relativePath: string;
  title: string;
  description?: string;
  tags: string[];
  language?: string;
  updated?: string;
  sourceRepo?: string;
  content: string;
  contentPreview: string;
  category: string;
}

export interface RepoDocFile {
  relativePath: string;  // Path relative to repo root
  name: string;          // Filename
  fileType: 'md' | 'txt' | 'rst' | 'adoc' | 'org';  // File type for icon/rendering
}

// Backward compatibility alias
export type RepoMarkdownFile = RepoDocFile;

export interface RepoInfo {
  name: string;
  description?: string;
  githubUrl?: string;
  localPath?: string;
  languages: string[];
  lastCommitDate?: string;
  status: 'synced' | 'local-only' | 'github-only';
  markdownFiles?: RepoDocFile[];  // Documentation files in the repo (.md, .txt, .rst, .adoc, .org)
}

export interface SearchResult {
  type: 'wiki' | 'repo';
  title: string;
  path: string;
  preview: string;
  score: number;
  tags?: string[];
  language?: string;
  repoName?: string;
}

export interface WikiIndex {
  documents: WikiDocument[];
  repos: RepoInfo[];
  categories: string[];
  buildTime: string;
  version: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  role: 'user' | 'admin';
}

export interface AuthSession {
  userId: string;
  token: string;
  expiresAt: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SearchRequest {
  query: string;
  category?: string;
  language?: string;
  limit?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
}
