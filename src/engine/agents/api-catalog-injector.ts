import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import { createLogger } from '../../logger';

const logger = createLogger('api-catalog-injector');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedCatalog: string | null = null;

function findSkillFile(): string | null {
  const candidates = [
    join(__dirname, '..', '..', '..', 'skills', 'api-catalog', 'SKILL.md'),
    join(__dirname, '..', '..', 'skills', 'api-catalog', 'SKILL.md'),
    join(process.cwd(), 'skills', 'api-catalog', 'SKILL.md'),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch { /* try next */ }
  }
  return null;
}

function loadCatalog(): string | null {
  if (cachedCatalog !== null) return cachedCatalog;

  try {
    const skillPath = findSkillFile();
    if (!skillPath) throw new Error('api-catalog SKILL.md not found in any candidate path');
    const raw = readFileSync(skillPath, 'utf8');
    const bodyStart = raw.indexOf('[api-catalog]');
    cachedCatalog = bodyStart >= 0 ? raw.slice(bodyStart) : raw;
    logger.info({ skillPath }, 'api-catalog loaded');
    return cachedCatalog;
  } catch (err) {
    logger.warn({ err }, 'failed to load api-catalog skill');
    cachedCatalog = '';
    return null;
  }
}

type ReqCtx = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };

const CTX_KEY = '__apiCatalogInjected';

export class ApiCatalogInjector implements Processor<'api-catalog-injector'> {
  readonly id = 'api-catalog-injector' as const;
  readonly name = 'API Catalog Injector';

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    if (args.stepNumber !== 0) return {};

    const rc = args.requestContext as ReqCtx | undefined;
    if (rc?.get?.(CTX_KEY)) return {};

    const content = loadCatalog();
    if (!content) return {};

    rc?.set?.(CTX_KEY, true);

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        { role: 'system' as const, content },
      ],
    };
  }
}
