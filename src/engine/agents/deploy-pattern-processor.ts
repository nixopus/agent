import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { PatternStore, formatPatternsBlock } from './pattern-store';
import { createLogger } from '../../logger';

const logger = createLogger('deploy-pattern-processor');

const ECOSYSTEM_SIGNALS: Record<string, RegExp> = {
  'next.js': /\bnext\.?js\b/i,
  'nuxt': /\bnuxt\b/i,
  'react': /\breact(?:\s+app)?\b/i,
  'vite': /\bvite\b/i,
  'remix': /\bremix\b/i,
  'astro': /\bastro\b/i,
  'svelte': /\bsvelte(?:kit)?\b/i,
  'angular': /\bangular\b/i,
  'express': /\bexpress\b/i,
  'fastify': /\bfastify\b/i,
  'hono': /\bhono\b/i,
  'django': /\bdjango\b/i,
  'flask': /\bflask\b/i,
  'fastapi': /\bfastapi\b/i,
  'rails': /\brails\b/i,
  'go': /\bgo(?:lang)?\b/i,
  'rust': /\brust\b/i,
  'java': /\bjava\b|spring\b/i,
  'dotnet': /\.net\b|dotnet\b|asp\.net\b/i,
  'php': /\bphp\b|laravel\b/i,
  'elixir': /\belixir\b|phoenix\b/i,
  'python': /\bpython\b/i,
  'node': /\bnode\.?js\b/i,
  'static': /\bstatic\s+site\b/i,
  'docker-compose': /\bcompose\b|multi.service\b/i,
};

const TOOL_ECOSYSTEM_MAP: Record<string, string> = {
  'next.config': 'next.js',
  'nuxt.config': 'nuxt',
  'vite.config': 'vite',
  'remix.config': 'remix',
  'astro.config': 'astro',
  'svelte.config': 'svelte',
  'angular.json': 'angular',
  'manage.py': 'django',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'mix.exs': 'elixir',
  'Gemfile': 'rails',
  'composer.json': 'php',
};

function detectEcosystemFromMessages(messages: MastraDBMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = typeof msg?.content === 'string'
      ? msg.content
      : JSON.stringify(msg?.content ?? '');

    for (const [eco, re] of Object.entries(ECOSYSTEM_SIGNALS)) {
      if (re.test(text)) return eco;
    }

    if (typeof msg?.content === 'object' && msg?.content) {
      const content = msg.content as Record<string, unknown>;
      const parts = content.parts as unknown[] | undefined;
      if (parts && Array.isArray(parts)) {
        for (const part of parts) {
          if (!part || typeof part !== 'object') continue;
          const p = part as Record<string, unknown>;
          if (p.type !== 'tool-result' && p.type !== 'tool-invocation') continue;
          const combined = JSON.stringify(p.output ?? '') + JSON.stringify(p.input ?? '');
          for (const [filename, eco] of Object.entries(TOOL_ECOSYSTEM_MAP)) {
            if (combined.includes(filename)) return eco;
          }
        }
      }
    }
  }
  return null;
}

type ReqCtx = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };

export class DeployPatternProcessor implements Processor<'deploy-pattern'> {
  readonly id = 'deploy-pattern' as const;
  readonly name = 'Deploy Pattern Injector';

  private patternStore: PatternStore | null = null;

  setPatternStore(store: PatternStore): void {
    this.patternStore = store;
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<ProcessInputStepResult> {
    if (!this.patternStore) return {};

    const rc = args.requestContext as ReqCtx | undefined;
    const cached = rc?.get?.('__deployPatterns') as string | undefined;
    if (cached !== undefined) {
      return cached
        ? { systemMessages: [...(args.systemMessages ?? []), { role: 'system' as const, content: cached }] }
        : {};
    }

    const ecosystem = detectEcosystemFromMessages(args.messages);
    if (!ecosystem) {
      rc?.set?.('__deployPatterns', '');
      return {};
    }

    rc?.set?.('detectedEcosystem', ecosystem);

    try {
      const patterns = await this.patternStore.getPatterns(ecosystem);
      const block = formatPatternsBlock(patterns);
      rc?.set?.('__deployPatterns', block);

      if (!block) return {};

      return {
        systemMessages: [
          ...(args.systemMessages ?? []),
          { role: 'system' as const, content: block },
        ],
      };
    } catch (err) {
      logger.warn({ err, ecosystem }, 'failed to inject deploy patterns');
      rc?.set?.('__deployPatterns', '');
      return {};
    }
  }
}

export { detectEcosystemFromMessages };
