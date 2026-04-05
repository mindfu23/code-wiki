/**
 * Shared types for Code Wiki Web Interface
 */

import type { RepoSentinels, CompletionAssessment } from '../netlify/functions/_shared/completionAssessment.js';

export type { RepoSentinels, CompletionAssessment };

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
  visibility?: 'public' | 'private';  // Document visibility (default: public)
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
  localPaths?: string[];  // All local checkouts pointing at the same GitHub URL (e.g., a scratch clone plus a main working copy). localPath is always localPaths[0] when set.
  aliases?: string[];     // Former names for this repo (renames detected via GitHub redirects) and names of merged duplicate local entries.
  languages: string[];
  lastCommitDate?: string;
  status: 'synced' | 'local-only' | 'github-only';
  visibility?: 'public' | 'private';  // Repo visibility (default: public)
  markdownFiles?: RepoDocFile[];  // Documentation files in the repo (.md, .txt, .rst, .adoc, .org)
  notes?: string;  // User-added notes about the repo
  sentinels?: RepoSentinels;  // Static structural signals detected from the repo's file tree (see completionAssessment.ts)
  completion?: CompletionAssessment;  // Lifecycle-stage classification derived from sentinels + commit recency; refined with live metrics by dashboard-data.ts
}

export interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  repo_url?: string;  // GitHub repo URL if connected
  updated_at: string;
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
