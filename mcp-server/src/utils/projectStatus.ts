/**
 * Project status registry: one place to record each project's lifecycle (dormant, shipped, ...)
 * without needing a wiki page per project.
 *
 * File: <privateWikiDirectory>/projects/project-status.yml (or PROJECT_STATUS_FILE). Format:
 *
 *   MyApp:
 *     lifecycle: dormant      # a value from stateFields.lifecycle in wiki/_taxonomy/schema.yml
 *     since: 2026-10-31       # optional
 *     note: Paused; may resume # optional
 *
 * The registry wins over a project page's `lifecycle` frontmatter. Read on every call (small file),
 * so edits show up without restarting the server.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { logger } from './logger.js';

export interface ProjectStatus {
  lifecycle: string;
  since?: string;
  note?: string;
}

interface StatusConfig {
  wikiDirectory?: string;
  privateWikiDirectory?: string;
}

const FALLBACK_LIFECYCLES = [
  'experimental', 'pre-release', 'shipped', 'mature', 'dormant', 'deprecated', 'archived',
];

export function statusFilePath(config: StatusConfig): string | null {
  if (process.env.PROJECT_STATUS_FILE) return process.env.PROJECT_STATUS_FILE;
  if (!config.privateWikiDirectory) return null;
  return path.join(config.privateWikiDirectory, 'projects', 'project-status.yml');
}

/** Allowed lifecycle values, read from the public taxonomy schema so the two never drift. */
export function allowedLifecycles(config: StatusConfig): string[] {
  try {
    const schemaPath = path.join(config.wikiDirectory || './wiki', '_taxonomy', 'schema.yml');
    const schema = yaml.load(fs.readFileSync(schemaPath, 'utf8')) as any;
    const values = schema?.stateFields?.lifecycle?.values;
    if (Array.isArray(values) && values.length) return values.map(String);
  } catch {
    // fall through
  }
  return FALLBACK_LIFECYCLES;
}

/** Map of lower-cased project name → status. Missing or unreadable file = empty map. */
export function loadProjectStatus(config: StatusConfig): Map<string, ProjectStatus> {
  const out = new Map<string, ProjectStatus>();
  const file = statusFilePath(config);
  if (!file || !fs.existsSync(file)) return out;

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    logger.warn('ProjectStatus', `Cannot parse ${file}: ${(err as Error).message}`);
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;

  const allowed = new Set(allowedLifecycles(config));
  for (const [name, value] of Object.entries(raw as Record<string, any>)) {
    const lifecycle = value?.lifecycle != null ? String(value.lifecycle) : '';
    if (!allowed.has(lifecycle)) {
      logger.warn('ProjectStatus', `${name}: lifecycle "${lifecycle}" is not in the schema; ignored`);
      continue;
    }
    out.set(name.toLowerCase(), {
      lifecycle,
      ...(value.since != null ? { since: value.since instanceof Date ? value.since.toISOString().slice(0, 10) : String(value.since) } : {}),
      ...(value.note != null ? { note: String(value.note) } : {}),
    });
  }
  return out;
}

export function statusFor(map: Map<string, ProjectStatus>, name: string | undefined): ProjectStatus | undefined {
  return name ? map.get(name.toLowerCase()) : undefined;
}
