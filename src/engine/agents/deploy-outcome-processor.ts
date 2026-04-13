import type { Processor, ProcessOutputResultArgs } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { PatternStore, type DeployOutcome } from './pattern-store';
import { detectEcosystemFromMessages } from './deploy-pattern-processor';
import { createLogger } from '../../logger';

const logger = createLogger('deploy-outcome-processor');

const FAILURE_RE = /(?:error|failed|cannot find|module not found|command not found|permission denied|ENOENT|EACCES|exit code [1-9]|build_failed|ERR!)/i;
const FIX_INDICATORS = [
  'write_workspace_files',
  'writeWorkspaceFiles',
  'github_create_or_update_file',
  'githubCreateOrUpdateFile',
  'update_application',
  'updateApplication',
];

interface ExtractedOutcome {
  outcome: DeployOutcome['outcome'];
  ecosystem: string;
  stepsCount: number;
  selfHealAttempts: number;
  failureSignatures: string[];
  fixesApplied: string[];
  applicationId: string | null;
  source: string | null;
}

function extractOutcome(messages: MastraDBMessage[]): ExtractedOutcome | null {
  let deployStarted = false;
  let lastStatus: string | null = null;
  let applicationId: string | null = null;
  let source: string | null = null;
  let stepsCount = 0;
  let selfHealAttempts = 0;
  const failureSignatures: string[] = [];
  const fixesApplied: string[] = [];
  const seenSignatures = new Set<string>();

  for (const msg of messages) {
    const content = msg?.content as Record<string, unknown> | undefined;
    if (!content) continue;

    if (msg?.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const srcMatch = text.match(/source=(\S+)/i);
      if (srcMatch) source = srcMatch[1];
    }

    const parts = content.parts as unknown[] | undefined;
    if (!parts || !Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type !== 'tool-invocation' && p.type !== 'tool-result') continue;

      stepsCount++;
      const toolName = (p.toolName ?? '') as string;

      if (toolName.includes('deploy') && (toolName.includes('Project') || toolName.includes('project'))) {
        deployStarted = true;
      }

      const outputStr = p.output !== undefined
        ? (typeof p.output === 'string' ? p.output : JSON.stringify(p.output))
        : '';

      const statusMatch = outputStr.match(/"status":\s*"([^"]+)"/);
      if (statusMatch) lastStatus = statusMatch[1];

      const appIdMatch = outputStr.match(/"(?:application_id|applicationId|id)":\s*"([0-9a-f-]{36})"/i);
      if (appIdMatch) applicationId = appIdMatch[1];

      if (FAILURE_RE.test(outputStr)) {
        const lines = outputStr.split(/\\n|\n/).filter((l) => FAILURE_RE.test(l));
        for (const line of lines.slice(0, 3)) {
          const cleaned = line.replace(/"/g, '').trim().slice(0, 200);
          if (cleaned && !seenSignatures.has(cleaned)) {
            seenSignatures.add(cleaned);
            failureSignatures.push(cleaned);
          }
        }
      }

      if (FIX_INDICATORS.some((fi) => toolName.includes(fi) || toolName === fi)) {
        const inputStr = p.input !== undefined
          ? (typeof p.input === 'string' ? p.input : JSON.stringify(p.input))
          : '';
        const pathMatch = inputStr.match(/"path":\s*"([^"]+)"/);
        if (pathMatch) fixesApplied.push(`wrote:${pathMatch[1]}`);
        else fixesApplied.push(`tool:${toolName}`);
      }

      if (toolName.includes('rollback') || toolName.includes('Rollback')) {
        selfHealAttempts++;
      }
      if (toolName.includes('redeploy') || toolName.includes('Redeploy') || toolName.includes('recover') || toolName.includes('Recover')) {
        selfHealAttempts++;
      }
    }
  }

  if (!deployStarted) return null;

  const ecosystem = detectEcosystemFromMessages(messages);
  if (!ecosystem) return null;

  let outcome: DeployOutcome['outcome'] = 'success';
  if (lastStatus === 'build_failed' || lastStatus === 'failed' || lastStatus === 'error') {
    outcome = 'failed';
  }
  if (messages.some((m) => {
    const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
    return /rollback/i.test(text) && /complet|success/i.test(text);
  })) {
    outcome = 'rollback';
  }

  return {
    outcome,
    ecosystem,
    stepsCount,
    selfHealAttempts: Math.min(selfHealAttempts, 3),
    failureSignatures: failureSignatures.slice(0, 10),
    fixesApplied: fixesApplied.slice(0, 10),
    applicationId,
    source,
  };
}

export class DeployOutcomeProcessor implements Processor<'deploy-outcome'> {
  readonly id = 'deploy-outcome' as const;
  readonly name = 'Deploy Outcome Recorder';

  private patternStore: PatternStore | null = null;

  setPatternStore(store: PatternStore): void {
    this.patternStore = store;
  }

  async processOutputResult(args: ProcessOutputResultArgs): Promise<MastraDBMessage[]> {
    if (!this.patternStore) return args.messages;

    const extracted = extractOutcome(args.messages);
    if (!extracted) return args.messages;

    const orgId = args.requestContext?.get?.('orgId') as string | undefined;

    try {
      await this.patternStore.recordOutcome({
        orgId,
        applicationId: extracted.applicationId ?? undefined,
        ecosystem: extracted.ecosystem,
        source: extracted.source ?? undefined,
        outcome: extracted.outcome,
        stepsCount: extracted.stepsCount,
        selfHealAttempts: extracted.selfHealAttempts,
        failureSignatures: extracted.failureSignatures,
        fixesApplied: extracted.fixesApplied,
      });

      if (extracted.failureSignatures.length > 0 && extracted.fixesApplied.length > 0) {
        const succeeded = extracted.outcome === 'success';
        for (const sig of extracted.failureSignatures) {
          await this.patternStore.upsertPattern(
            extracted.ecosystem,
            'failure_fix',
            sig,
            extracted.fixesApplied.join('; '),
            succeeded,
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, 'failed to record deploy outcome');
    }

    return args.messages;
  }
}

export { extractOutcome };
