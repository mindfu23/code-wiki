/**
 * Completion-level assessment for a repository.
 *
 * Combines static structural signals (collected during the index build from
 * the repo's file tree) with optional live metrics (deploy status, CI status,
 * open issues — supplied by dashboard-data.ts at request time) into a
 * coarse "where is this project in its lifecycle?" classification.
 *
 * The classifier is deliberately heuristic: its job is to be *consistently
 * wrong in understandable ways*, so when a stage looks off you can trace
 * it back to a rule in this file. Every contributing signal is recorded in
 * `reasons` so the UI can show a tooltip explaining *why* a repo was
 * classified the way it was.
 *
 * Scoring is on four axes:
 *   - scaffold       (does this exist as a project at all?)         0–4
 *   - implementation (has real work been done beyond scaffolding?)  0–3
 *   - deployed       (is it reachable by users?)                    0–4
 *   - maintained     (is someone still actively working on it?)     0–4
 *
 * The tuple of axis scores plus commit/deploy recency maps to a stage.
 */

export interface RepoSentinels {
  /** README.md / README.txt / README.rst at repo root */
  hasReadme: boolean;
  /** CLAUDE.md at repo root — signals the project is set up for agentic work */
  hasClaudeMd: boolean;
  /** package.json, requirements.txt, Cargo.toml, go.mod, pyproject.toml, Gemfile, composer.json */
  hasPackageManifest: boolean;
  /** netlify.toml, vercel.json, Dockerfile, fly.toml, app.yaml, railway.toml, render.yaml */
  hasDeployConfig: boolean;
  /** Any .yml/.yaml file under .github/workflows/ */
  hasCi: boolean;
  /** tests/, __tests__/, *.test.*, *.spec.*, vitest.config.*, jest.config.*, pytest.ini */
  hasTests: boolean;
  /** .env.example, .env.sample, env.example — signals API key hygiene */
  hasEnvExample: boolean;
  /** Count of files with common source-code extensions (excludes docs, configs, lockfiles) */
  sourceFileCount: number;
}

export interface CompletionLiveMetrics {
  deployStatus?: 'healthy' | 'warning' | 'error' | 'unknown';
  deployPlatform?: string;
  actionsStatus?: 'healthy' | 'warning' | 'error' | 'unknown';
  openIssues?: number;
  lastDeployDate?: string;
  deploySuccessRate?: number;
}

export interface CompletionAssessment {
  stage: 'stub' | 'scaffold' | 'in-progress' | 'deployed' | 'mature' | 'stale' | 'abandoned' | 'reference';
  signals: {
    scaffold: number;
    implementation: number;
    deployed: number;
    maintained: number;
  };
  /** Human-readable list of contributing signals for display in tooltips */
  reasons: string[];
}

const STUB_SENTINELS: RepoSentinels = {
  hasReadme: false,
  hasClaudeMd: false,
  hasPackageManifest: false,
  hasDeployConfig: false,
  hasCi: false,
  hasTests: false,
  hasEnvExample: false,
  sourceFileCount: 0,
};

export function emptySentinels(): RepoSentinels {
  return { ...STUB_SENTINELS };
}

/** Days elapsed since an ISO date string, or Infinity if undefined/invalid. */
function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

/**
 * Compute a completion assessment from static sentinels plus optional live metrics.
 *
 * Called in two places:
 *   1. indexBuilder.ts: with sentinels only — produces a baseline assessment
 *      that's good enough for repos without Observatory coverage.
 *   2. dashboard-data.ts: with sentinels + live deploy/actions/issues data —
 *      refines the "deployed" and "maintained" axes using real platform state.
 */
export function assessCompletion(
  sentinels: RepoSentinels,
  options: {
    description?: string;
    lastCommitDate?: string;
    live?: CompletionLiveMetrics;
  } = {}
): CompletionAssessment {
  const { description, lastCommitDate, live = {} } = options;
  const reasons: string[] = [];

  // --- Scaffold axis: does this project exist as a project? -------------
  let scaffold = 0;
  if (sentinels.hasReadme) { scaffold++; reasons.push('has README'); }
  if (description && description.trim().length > 0) { scaffold++; reasons.push('has description'); }
  if (sentinels.hasPackageManifest) { scaffold++; reasons.push('has package manifest'); }
  if (sentinels.sourceFileCount > 0) { scaffold++; reasons.push('has source files'); }

  // --- Implementation axis: is there real work beyond scaffolding? -----
  const commitAge = daysSince(lastCommitDate);
  let implementation = 0;
  if (sentinels.sourceFileCount >= 5) { implementation++; reasons.push(`${sentinels.sourceFileCount} source files`); }
  if (sentinels.sourceFileCount >= 20) { implementation++; reasons.push('non-trivial size'); }
  if (commitAge <= 90) { implementation++; reasons.push('committed in last 90 days'); }

  // --- Deployed axis: is it reachable by users? ------------------------
  let deployed = 0;
  if (sentinels.hasDeployConfig) { deployed++; reasons.push('has deploy config'); }
  if (live.deployPlatform) { deployed++; reasons.push(`deployed to ${live.deployPlatform}`); }
  if (live.deployStatus === 'healthy') { deployed++; reasons.push('deploy healthy'); }
  if (typeof live.deploySuccessRate === 'number' && live.deploySuccessRate >= 0.8) {
    deployed++;
    reasons.push(`${Math.round(live.deploySuccessRate * 100)}% deploy success`);
  }

  // --- Maintained axis: is someone still actively working on it? -------
  let maintained = 0;
  if (commitAge <= 30) { maintained++; reasons.push('committed in last 30 days'); }
  if (live.actionsStatus === 'healthy') {
    maintained++;
    reasons.push('CI passing');
  } else if (sentinels.hasCi && live.actionsStatus === undefined) {
    // Static fallback: credit CI presence when live status isn't available
    maintained++;
    reasons.push('CI configured');
  }
  if ((live.openIssues ?? 0) < 5) { maintained++; reasons.push(`${live.openIssues ?? 0} open issues`); }
  if (live.deployPlatform) {
    // Recent deploy OR deployed project whose deploy date we don't know
    const deployAge = daysSince(live.lastDeployDate);
    if (deployAge <= 30) { maintained++; reasons.push('deployed in last 30 days'); }
  } else {
    // Non-deployed projects can't be penalized on deploy recency — give the point
    maintained++;
  }

  // --- Stage classification --------------------------------------------
  // Reference projects (docs-only, no source, but have a README): classify as reference
  // so they don't get misclassified as "stub" or "abandoned".
  if (
    sentinels.hasReadme
    && sentinels.sourceFileCount === 0
    && !sentinels.hasPackageManifest
  ) {
    return {
      stage: 'reference',
      signals: { scaffold, implementation, deployed, maintained },
      reasons: [...reasons, 'docs-only repository'],
    };
  }

  let stage: CompletionAssessment['stage'];
  if (commitAge > 180 && deployed < 2) {
    stage = 'abandoned';
  } else if (commitAge > 90 && deployed >= 2) {
    stage = 'stale';
  } else if (maintained >= 3 && deployed === 4) {
    stage = 'mature';
  } else if (deployed >= 2 && maintained >= 2) {
    stage = 'deployed';
  } else if (implementation >= 2) {
    stage = 'in-progress';
  } else if (scaffold >= 2) {
    stage = 'scaffold';
  } else {
    stage = 'stub';
  }

  return {
    stage,
    signals: { scaffold, implementation, deployed, maintained },
    reasons,
  };
}

// --- Sentinel detection from a list of repo file paths -------------------

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.cs', '.cpp', '.cc', '.c', '.h', '.hpp',
  '.swift', '.kt', '.scala', '.dart',
  '.vue', '.svelte', '.astro',
  '.html', '.css', '.scss', '.sass',
  '.sh', '.bash', '.zsh',
]);

const PACKAGE_MANIFESTS = new Set([
  'package.json',
  'requirements.txt',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'gemfile',
  'composer.json',
  'pubspec.yaml',
]);

const DEPLOY_CONFIGS = new Set([
  'netlify.toml',
  'vercel.json',
  'dockerfile',
  'fly.toml',
  'app.yaml',
  'railway.toml',
  'render.yaml',
  'wrangler.toml',
  'serverless.yml',
  'serverless.yaml',
]);

const ENV_EXAMPLE_NAMES = new Set([
  '.env.example',
  '.env.sample',
  'env.example',
  'env.sample',
]);

const TEST_FILE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx|mjs|cjs|py)$/i,
  /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /(^|\/)(vitest|jest|playwright|cypress)\.config\.(ts|js|mjs|cjs)$/i,
  /(^|\/)pytest\.ini$/i,
  /(^|\/)tox\.ini$/i,
];

const TEST_DIR_SEGMENTS = new Set(['tests', 'test', '__tests__', 'spec']);

function extensionOf(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
}

function baseNameOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return (idx >= 0 ? filePath.slice(idx + 1) : filePath).toLowerCase();
}

/**
 * Scan a list of repo-relative file paths and extract sentinel signals.
 * Fast enough to run per-repo during the index build — it's just string ops
 * over a list we already have in memory.
 */
export function detectSentinels(relativePaths: string[]): RepoSentinels {
  const sentinels = emptySentinels();

  for (const raw of relativePaths) {
    const p = raw.replace(/\\/g, '/');
    const base = baseNameOf(p);
    const ext = extensionOf(p);
    const segments = p.toLowerCase().split('/');
    const isRoot = !p.includes('/');
    // Allow one level of nesting so monorepo layouts (web/netlify.toml,
    // api/Dockerfile, backend/package.json) are detected too.
    const isRootOrNested = segments.length <= 2;

    // README (root only — a README in a subdir doesn't count as "the project has a README")
    if (isRoot && /^readme(\.(md|txt|rst|adoc|org))?$/i.test(base)) {
      sentinels.hasReadme = true;
    }

    // CLAUDE.md
    if (isRoot && base === 'claude.md') {
      sentinels.hasClaudeMd = true;
    }

    // Package manifest — root or one level down (monorepo subprojects count)
    if (isRootOrNested && PACKAGE_MANIFESTS.has(base)) {
      sentinels.hasPackageManifest = true;
    }

    // Deploy config — root or one level down
    if (isRootOrNested && DEPLOY_CONFIGS.has(base)) {
      sentinels.hasDeployConfig = true;
    }

    // CI: .github/workflows/*.yml|yaml
    if (
      segments.length >= 3
      && segments[0] === '.github'
      && segments[1] === 'workflows'
      && (ext === '.yml' || ext === '.yaml')
    ) {
      sentinels.hasCi = true;
    }

    // Env example
    if (isRoot && ENV_EXAMPLE_NAMES.has(base)) {
      sentinels.hasEnvExample = true;
    }

    // Tests: directory-based or filename-based
    if (!sentinels.hasTests) {
      if (segments.some((seg) => TEST_DIR_SEGMENTS.has(seg))) {
        sentinels.hasTests = true;
      } else if (TEST_FILE_PATTERNS.some((re) => re.test(p))) {
        sentinels.hasTests = true;
      }
    }

    // Source file count — skip files under node_modules, dist, build, etc.
    // (the indexer's tree scan already excludes these, but be defensive)
    if (SOURCE_EXTENSIONS.has(ext)) {
      const inSkipDir = segments.some((seg) =>
        seg === 'node_modules'
        || seg === 'dist'
        || seg === 'build'
        || seg === '.next'
        || seg === 'vendor'
      );
      if (!inSkipDir) {
        sentinels.sourceFileCount++;
      }
    }
  }

  return sentinels;
}
