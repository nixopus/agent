import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { createLogger } from '../../logger';

const logger = createLogger('deploy-flow-injector');

const DEPLOY_INTENT_RE = /\b(deploy|launch|ship|go\s+live|push\s+to\s+prod|put\s+(?:it\s+)?(?:on|up)|host|set\s*up)\b/i;

let cachedSkillContent: string | null = null;

function loadSkillContent(): string | null {
  if (cachedSkillContent !== null) return cachedSkillContent;

  try {
    const skillPath = join(process.cwd(), 'skills', 'deploy-flow', 'SKILL.md');
    const raw = readFileSync(skillPath, 'utf8');
    const bodyStart = raw.indexOf('# Deploy Flow');
    cachedSkillContent = bodyStart >= 0 ? raw.slice(bodyStart) : raw;
    return cachedSkillContent;
  } catch (err) {
    logger.warn({ err }, 'failed to load deploy-flow skill, will fall back to LLM skill loading');
    cachedSkillContent = '';
    return null;
  }
}

function hasDeployIntent(messages: MastraDBMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;

    const text = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');

    if (DEPLOY_INTENT_RE.test(text)) return true;
  }
  return false;
}

type ReqCtx = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };

const CTX_KEY = '__deployFlowInjected';

export class DeployFlowInjector implements Processor<'deploy-flow-injector'> {
  readonly id = 'deploy-flow-injector' as const;
  readonly name = 'Deploy Flow Injector';

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    if (args.stepNumber !== 0) return {};

    const rc = args.requestContext as ReqCtx | undefined;
    if (rc?.get?.(CTX_KEY)) return {};

    if (!hasDeployIntent(args.messages)) return {};

    const content = loadSkillContent();
    if (!content) return {};

    rc?.set?.(CTX_KEY, true);

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        { role: 'system' as const, content: `[deploy-flow]\n${content}\n[/deploy-flow]` },
      ],
    };
  }
}
