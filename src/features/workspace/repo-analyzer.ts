import type { FetchedFile } from './support';

export type Confidence = 'high' | 'medium' | 'low';

export interface ConfidenceValue<T> {
  value: T;
  source: string;
  confidence: Confidence;
}

export interface RepoHints {
  confidence: Confidence;
  ecosystem: string | null;
  framework: ConfidenceValue<string> | null;
  port: ConfidenceValue<number> | null;
  hasDockerfile: boolean;
  dockerfilePath: string | null;
  hasDockerCompose: boolean;
  hasDockerignore: boolean;
  packageManager: string | null;
  isMonorepo: boolean;
  monorepoMarkers: string[];
  buildCommand: string | null;
  startCommand: string | null;
  envFiles: string[];
  requiredEnvVars: string[];
  warnings: string[];
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

const FRAMEWORK_DETECTORS: Array<{
  dep: string;
  framework: string;
  ecosystem: string;
  defaultPort: number;
}> = [
  { dep: 'next', framework: 'next.js', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'nuxt', framework: 'nuxt', ecosystem: 'node', defaultPort: 3000 },
  { dep: '@remix-run/node', framework: 'remix', ecosystem: 'node', defaultPort: 3000 },
  { dep: '@remix-run/react', framework: 'remix', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'astro', framework: 'astro', ecosystem: 'node', defaultPort: 4321 },
  { dep: 'svelte', framework: 'svelte', ecosystem: 'node', defaultPort: 5173 },
  { dep: '@sveltejs/kit', framework: 'sveltekit', ecosystem: 'node', defaultPort: 3000 },
  { dep: '@angular/core', framework: 'angular', ecosystem: 'node', defaultPort: 4200 },
  { dep: 'react-scripts', framework: 'create-react-app', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'vite', framework: 'vite', ecosystem: 'node', defaultPort: 5173 },
  { dep: 'express', framework: 'express', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'fastify', framework: 'fastify', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'hono', framework: 'hono', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'koa', framework: 'koa', ecosystem: 'node', defaultPort: 3000 },
  { dep: 'nest', framework: 'nestjs', ecosystem: 'node', defaultPort: 3000 },
  { dep: '@nestjs/core', framework: 'nestjs', ecosystem: 'node', defaultPort: 3000 },
];

const SERVER_FRAMEWORKS = new Set([
  'express', 'fastify', 'hono', 'koa', 'nestjs',
]);

const FULLSTACK_FRAMEWORKS = new Set([
  'next.js', 'nuxt', 'remix', 'sveltekit',
]);

const PYTHON_FRAMEWORKS: Record<string, { framework: string; port: number }> = {
  django: { framework: 'django', port: 8000 },
  flask: { framework: 'flask', port: 5000 },
  fastapi: { framework: 'fastapi', port: 8000 },
  uvicorn: { framework: 'fastapi', port: 8000 },
  gunicorn: { framework: 'gunicorn', port: 8000 },
  starlette: { framework: 'starlette', port: 8000 },
};

const MONOREPO_MARKERS = [
  'turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml',
];

const LOCKFILE_TO_PM: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun',
};

const EXPOSE_RE = /^\s*EXPOSE\s+(\d+)/m;
const ENV_VAR_RE = /^([A-Z][A-Z0-9_]{2,})=/gm;
const PORT_IN_SCRIPT_RE = /(?:--port|--listen|-p)\s+(\d+)|PORT[=:\s]+(\d+)/;

function findFile(files: FetchedFile[], name: string): FetchedFile | undefined {
  return files.find((f) => f.path === name || f.path.endsWith(`/${name}`));
}

function findRootFile(files: FetchedFile[], name: string): FetchedFile | undefined {
  return files.find((f) => f.path === name);
}

function hasRootFile(files: FetchedFile[], name: string): boolean {
  return files.some((f) => f.path === name);
}

function hasRootDir(files: FetchedFile[], dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return files.some((f) => f.path.startsWith(prefix));
}

function safeParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function minConfidence(...values: Confidence[]): Confidence {
  if (values.includes('low')) return 'low';
  if (values.includes('medium')) return 'medium';
  return 'high';
}

function detectPortFromDockerfile(content: string): number | null {
  const match = content.match(EXPOSE_RE);
  return match ? parseInt(match[1], 10) : null;
}

function detectPortFromScripts(scripts: Record<string, string>): number | null {
  for (const cmd of Object.values(scripts)) {
    const match = cmd.match(PORT_IN_SCRIPT_RE);
    if (match) {
      const port = parseInt(match[1] || match[2], 10);
      if (port > 0 && port < 65536) return port;
    }
  }
  return null;
}

function extractEnvVars(content: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(ENV_VAR_RE.source, 'gm');
  while ((match = re.exec(content)) !== null) {
    vars.push(match[1]);
  }
  return vars;
}

function detectPythonFramework(
  files: FetchedFile[],
): { framework: string; port: number } | null {
  const reqFile = findRootFile(files, 'requirements.txt');
  const pyprojectFile = findRootFile(files, 'pyproject.toml');
  const pipfileFile = findRootFile(files, 'Pipfile');

  const content = reqFile?.content ?? pyprojectFile?.content ?? pipfileFile?.content ?? '';

  for (const [pkg, info] of Object.entries(PYTHON_FRAMEWORKS)) {
    if (new RegExp(`\\b${pkg}\\b`, 'i').test(content)) {
      return info;
    }
  }
  return null;
}

export function analyzeFiles(files: FetchedFile[]): RepoHints {
  const warnings: string[] = [];
  let ecosystem: string | null = null;
  let framework: ConfidenceValue<string> | null = null;
  let port: ConfidenceValue<number> | null = null;
  let buildCommand: string | null = null;
  let startCommand: string | null = null;

  const hasDockerfile = hasRootFile(files, 'Dockerfile');
  const dockerfilePath = hasDockerfile ? 'Dockerfile' : null;
  const hasDockerCompose = hasRootFile(files, 'docker-compose.yml') || hasRootFile(files, 'docker-compose.yaml');
  const hasDockerignore = hasRootFile(files, '.dockerignore');

  let packageManager: string | null = null;
  for (const [lockfile, pm] of Object.entries(LOCKFILE_TO_PM)) {
    if (hasRootFile(files, lockfile)) {
      packageManager = pm;
      break;
    }
  }

  const foundMonorepoMarkers: string[] = [];
  for (const marker of MONOREPO_MARKERS) {
    if (hasRootFile(files, marker)) foundMonorepoMarkers.push(marker);
  }
  const hasAppsDir = hasRootDir(files, 'apps');
  const hasServicesDir = hasRootDir(files, 'services');

  const pkgFile = findRootFile(files, 'package.json');
  const pkg = pkgFile ? safeParseJson<PackageJson>(pkgFile.content) : null;
  let isMonorepo = foundMonorepoMarkers.length > 0;

  if (pkg?.workspaces) {
    isMonorepo = true;
    foundMonorepoMarkers.push('package.json workspaces');
  }

  if (!isMonorepo && hasAppsDir) {
    const subPkgCount = files.filter(
      (f) => f.path.startsWith('apps/') && f.path.endsWith('/package.json') && f.path.split('/').length === 3,
    ).length;
    if (subPkgCount >= 2) {
      isMonorepo = true;
      foundMonorepoMarkers.push('apps/ with multiple packages');
    }
  }

  // --- Node.js ecosystem ---
  if (pkg) {
    ecosystem = 'node';
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const matched: Array<typeof FRAMEWORK_DETECTORS[number]> = [];

    for (const detector of FRAMEWORK_DETECTORS) {
      if (allDeps[detector.dep]) matched.push(detector);
    }

    const fullstackMatch = matched.find((m) => FULLSTACK_FRAMEWORKS.has(m.framework));
    const serverMatch = matched.find((m) => SERVER_FRAMEWORKS.has(m.framework));

    if (matched.length === 1) {
      framework = { value: matched[0].framework, source: `package.json dep: ${matched[0].dep}`, confidence: 'high' };
    } else if (fullstackMatch && serverMatch) {
      framework = { value: fullstackMatch.framework, source: `package.json dep: ${fullstackMatch.dep}`, confidence: 'high' };
    } else if (fullstackMatch) {
      framework = { value: fullstackMatch.framework, source: `package.json dep: ${fullstackMatch.dep}`, confidence: 'high' };
    } else if (matched.length > 1) {
      framework = { value: matched[0].framework, source: `package.json dep: ${matched[0].dep}`, confidence: 'medium' };
      warnings.push(`Multiple frameworks detected (${matched.map((m) => m.framework).join(', ')}) — verify primary`);
    }

    if (packageManager && pkg.scripts?.build) {
      buildCommand = `${packageManager} run build`;
    }
    if (packageManager && pkg.scripts?.start) {
      startCommand = `${packageManager} start`;
    } else if (packageManager && pkg.scripts?.dev) {
      startCommand = `${packageManager} run dev`;
    }
  }

  // --- Go ecosystem ---
  if (!ecosystem && hasRootFile(files, 'go.mod')) {
    ecosystem = 'go';
    framework = { value: 'go', source: 'go.mod', confidence: 'high' };
    buildCommand = 'go build -o app ./...';
    startCommand = './app';
  }

  // --- Python ecosystem ---
  if (!ecosystem) {
    const pyResult = detectPythonFramework(files);
    if (pyResult) {
      ecosystem = 'python';
      framework = { value: pyResult.framework, source: 'requirements', confidence: 'high' };
      if (!port) {
        port = { value: pyResult.port, source: 'framework default', confidence: 'low' };
      }
    } else if (hasRootFile(files, 'requirements.txt') || hasRootFile(files, 'pyproject.toml')) {
      ecosystem = 'python';
    }
  }

  // --- Rust ecosystem ---
  if (!ecosystem && hasRootFile(files, 'Cargo.toml')) {
    ecosystem = 'rust';
    framework = { value: 'rust', source: 'Cargo.toml', confidence: 'high' };
    buildCommand = 'cargo build --release';
  }

  // --- Java ecosystem ---
  if (!ecosystem) {
    if (hasRootFile(files, 'pom.xml')) {
      ecosystem = 'java';
      framework = { value: 'maven', source: 'pom.xml', confidence: 'high' };
      buildCommand = 'mvn package';
    } else if (hasRootFile(files, 'build.gradle') || hasRootFile(files, 'build.gradle.kts')) {
      ecosystem = 'java';
      framework = { value: 'gradle', source: 'build.gradle', confidence: 'high' };
      buildCommand = 'gradle build';
    }
  }

  // --- Ruby ecosystem ---
  if (!ecosystem && hasRootFile(files, 'Gemfile')) {
    ecosystem = 'ruby';
    const gemfileContent = findRootFile(files, 'Gemfile')?.content ?? '';
    if (/\brails\b/i.test(gemfileContent)) {
      framework = { value: 'rails', source: 'Gemfile', confidence: 'high' };
    }
  }

  // --- Elixir ecosystem ---
  if (!ecosystem && hasRootFile(files, 'mix.exs')) {
    ecosystem = 'elixir';
    framework = { value: 'elixir', source: 'mix.exs', confidence: 'high' };
  }

  // --- PHP ecosystem ---
  if (!ecosystem && hasRootFile(files, 'composer.json')) {
    ecosystem = 'php';
    const composerContent = findRootFile(files, 'composer.json')?.content ?? '';
    if (/laravel/i.test(composerContent)) {
      framework = { value: 'laravel', source: 'composer.json', confidence: 'high' };
    }
  }

  // --- Port detection (priority: Dockerfile EXPOSE > docker-compose > scripts > framework default) ---
  if (hasDockerfile) {
    const dockerfileContent = findRootFile(files, 'Dockerfile')!.content;
    const exposedPort = detectPortFromDockerfile(dockerfileContent);
    if (exposedPort) {
      port = { value: exposedPort, source: 'Dockerfile EXPOSE', confidence: 'high' };
    }
  }

  if (!port && hasDockerCompose) {
    const composeFile = findRootFile(files, 'docker-compose.yml') ?? findRootFile(files, 'docker-compose.yaml');
    if (composeFile) {
      const portsMatch = composeFile.content.match(/ports:\s*\n\s*-\s*["']?(\d+):(\d+)/);
      if (portsMatch) {
        port = { value: parseInt(portsMatch[2], 10), source: 'docker-compose ports', confidence: 'high' };
      }
    }
  }

  if (!port && pkg?.scripts) {
    const scriptPort = detectPortFromScripts(pkg.scripts);
    if (scriptPort) {
      port = { value: scriptPort, source: 'package.json scripts', confidence: 'medium' };
    }
  }

  if (!port) {
    const envSample = findRootFile(files, '.env.example') ?? findRootFile(files, '.env.sample');
    if (envSample) {
      const envPortMatch = envSample.content.match(/^PORT=(\d+)/m);
      if (envPortMatch) {
        port = { value: parseInt(envPortMatch[1], 10), source: '.env.example', confidence: 'medium' };
      }
    }
  }

  if (!port && framework) {
    const matchedDetector = FRAMEWORK_DETECTORS.find((d) => d.framework === framework!.value);
    if (matchedDetector) {
      port = { value: matchedDetector.defaultPort, source: 'framework default', confidence: 'low' };
    }
  }

  // --- Env var detection ---
  const envFiles: string[] = [];
  const allEnvVars = new Set<string>();
  for (const envName of ['.env.example', '.env.sample', '.env.template']) {
    const envFile = findRootFile(files, envName);
    if (envFile) {
      envFiles.push(envName);
      for (const v of extractEnvVars(envFile.content)) allEnvVars.add(v);
    }
  }

  // --- Monorepo warning ---
  if (isMonorepo) {
    warnings.push(`Monorepo detected (${foundMonorepoMarkers.join(', ')}) — may need per-service deploy`);
  }

  // --- Docker-compose without Dockerfile ---
  if (hasDockerCompose && !hasDockerfile) {
    warnings.push('docker-compose.yml found but no root Dockerfile — likely multi-service setup');
  }

  // --- Overall confidence ---
  const fieldConfidences: Confidence[] = ['high'];
  if (framework) fieldConfidences.push(framework.confidence);
  if (port) fieldConfidences.push(port.confidence);
  if (isMonorepo) fieldConfidences.push('medium');
  if (warnings.length > 0 && !warnings.every((w) => w.includes('Monorepo'))) {
    fieldConfidences.push('medium');
  }

  return {
    confidence: minConfidence(...fieldConfidences),
    ecosystem,
    framework,
    port,
    hasDockerfile,
    dockerfilePath,
    hasDockerCompose,
    hasDockerignore,
    packageManager,
    isMonorepo,
    monorepoMarkers: foundMonorepoMarkers,
    buildCommand,
    startCommand,
    envFiles,
    requiredEnvVars: [...allEnvVars],
    warnings,
  };
}
