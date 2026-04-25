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

interface SampleAppConfig {
  urlPattern: RegExp;
  branch: string;
  name: string;
  port: number;
  buildPack: string;
  recipe: string;
}

const SAMPLE_APP_CONFIGS: SampleAppConfig[] = [
  {
    urlPattern: /github\.com\/nixopus\/sample-app/i,
    branch: 'main',
    name: 'Nixopus Sample App',
    port: 3000,
    buildPack: 'dockerfile',
    recipe: [
      '[sample-app-fast-path]',
      'This is the Nixopus sample app (Next.js 16, Dockerfile included, port 3000). Everything is pre-analyzed — skip all exploration.',
      '',
      'Execute EXACTLY these steps, no more:',
      '1. load_remote_repository({ repoUrl: "<THE_URL>", branch: "main" }) — returns hints (will be confidence: "high")',
      '2. quick_deploy({ name: "sample-app", port: 3000, build_pack: "dockerfile" }) — creates + deploys in one call, auto-generates subdomain',
      '3. getApplicationDeployments({ applicationId: "<FROM_STEP_2>", limit: 1 }) — get deployment ID, share the domain URL with the user',
      '',
      'Do NOT:',
      '- Load any skills (deploy-flow, dockerfile-generation, node-deploy, etc.)',
      '- Call read_file, grep, list_directory, or any workspace exploration tools',
      '- Call getApplication, getApplications, or getGithubConnectors',
      '- Call generateRandomSubdomain (quick_deploy does this automatically)',
      '- Call getDeploymentLogs unless the deployment fails',
      '- Ask the user for confirmation — just deploy it',
      '[/sample-app-fast-path]',
    ].join('\n'),
  },
];

function getLastUserText(messages: MastraDBMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
  }
  return '';
}

function matchSampleApp(text: string): SampleAppConfig | null {
  for (const config of SAMPLE_APP_CONFIGS) {
    if (config.urlPattern.test(text)) return config;
  }
  return null;
}

function hasDeployIntent(messages: MastraDBMessage[]): boolean {
  const text = getLastUserText(messages);
  return DEPLOY_INTENT_RE.test(text);
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

    rc?.set?.(CTX_KEY, true);

    const userText = getLastUserText(args.messages);
    const sampleApp = matchSampleApp(userText);

    if (sampleApp) {
      const recipe = sampleApp.recipe.replace('<THE_URL>', userText.match(/https?:\/\/github\.com\/nixopus\/sample-app[^\s)"]*/i)?.[0] ?? 'https://github.com/nixopus/sample-app');
      logger.info({ sample: sampleApp.name }, 'sample app detected, injecting fast-path recipe');
      return {
        systemMessages: [
          ...(args.systemMessages ?? []),
          { role: 'system' as const, content: recipe },
        ],
      };
    }

    const content = loadSkillContent();
    if (!content) return {};

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        { role: 'system' as const, content: `[deploy-flow]\n${content}\n[/deploy-flow]` },
      ],
    };
  }
}

export { SAMPLE_APP_CONFIGS, matchSampleApp, getLastUserText };
