// Guards CODE_SERVICE_SIGNALS against regex features git grep -E lacks on some platforms
// (e.g. \s and \b on macOS): each pattern must match its sample via real git grep.
// Run: npx tsx --test scripts/tests/codeSignals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { CODE_SERVICE_SIGNALS, inferServicesFromCode } from '../lib/codeSignals.js';

const SAMPLES: Record<string, string> = {
  'google-gemini-api': "fetch('https://generativelanguage.googleapis.com/v1beta/models')",
  'anthropic-api': 'import anthropic',
  'openai-api': "import OpenAI from 'openai'",
  'perplexity-api': "const u = 'https://api.perplexity.ai/chat'",
  'xai-api': "base_url='https://api.x.ai/v1'",
  'deepseek-api': "base='https://api.deepseek.com'",
  'huggingface-api': "import { HfInference } from '@huggingface/inference'",
  'spotify-api': "get('https://api.spotify.com/v1/me')",
  'stripe-api': 'import stripe',
  'google-sheets-api': 'import gspread',
  'github-api': "import { Octokit } from '@octokit/rest'",
  'supabase-api': "createClient('https://abc.supabase.co', key)",
  'netlify-api': "fetch('https://api.netlify.com/api/v1/sites')",
  'cloudflare-api': "fetch('https://api.cloudflare.com/client/v4')",
};

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'codesig-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body + '\n');
  }
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}

test('every service pattern matches its sample through real git grep', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(CODE_SERVICE_SIGNALS).sort());
  for (const [service, sample] of Object.entries(SAMPLES)) {
    const dir = repoWith({ 'src/x.ts': sample });
    assert.deepEqual(inferServicesFromCode(dir), [service], `pattern for ${service} failed on: ${sample}`);
  }
});

test('word boundaries hold and docs/env examples are ignored', () => {
  const dir = repoWith({
    'src/a.py': 'import anthropicish\nfrom openaiclient import x',
    'README.md': 'calls https://api.x.ai',
    '.env.example': '# https://api.cloudflare.com/client/v4',
  });
  assert.deepEqual(inferServicesFromCode(dir), []);
});
