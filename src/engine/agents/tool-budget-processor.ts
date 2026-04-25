import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';

const GOVERNOR_STATE_KEY = 'governorState';

interface GovernorState {
  warnings: string[];
}

function countToolCalls(messages: MastraDBMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    const content = msg?.content as Record<string, unknown> | undefined;
    if (!content) continue;

    const parts = content.parts as unknown[] | undefined;
    if (!parts || !Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'tool-invocation' || p.type === 'tool-result') count++;
    }
  }
  return count;
}

function budgetMessage(step: number, maxSteps: number): string | null {
  const pct = step / maxSteps;
  if (pct < 0.5) return null;
  if (pct < 0.75) return `[tool-budget] step=${step}/${maxSteps} — be efficient [/tool-budget]`;
  if (pct < 0.9) return `[tool-budget] step=${step}/${maxSteps} — wrap up, finalize with remaining steps [/tool-budget]`;
  return `[tool-budget] step=${step}/${maxSteps} — CRITICAL: few steps remaining. Complete immediately. [/tool-budget]`;
}

function formatEfficiencyWarnings(warnings: string[]): string | null {
  if (warnings.length === 0) return null;
  const lines = warnings.map((w) => `- ${w}`).join('\n');
  return `[tool-efficiency]\n${lines}\n[/tool-efficiency]`;
}

export class ToolBudgetProcessor implements Processor<'tool-budget'> {
  readonly id = 'tool-budget' as const;
  readonly name = 'Tool Budget';

  private maxSteps: number;

  constructor(maxSteps = 100) {
    this.maxSteps = maxSteps;
  }

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    const step = args.stepNumber;
    const parts: string[] = [];

    const budget = budgetMessage(step, this.maxSteps);
    if (budget) parts.push(budget);

    const state = args.requestContext?.get?.(GOVERNOR_STATE_KEY) as GovernorState | undefined;
    if (state?.warnings?.length) {
      const efficiency = formatEfficiencyWarnings(state.warnings);
      if (efficiency) parts.push(efficiency);
      state.warnings.length = 0;
    }

    if (parts.length === 0) return {};

    const toolCalls = countToolCalls(args.messages);
    if (toolCalls > 0 && budget) {
      parts[0] = parts[0].replace('[/tool-budget]', `tools_used=${toolCalls} [/tool-budget]`);
    }

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        { role: 'system' as const, content: parts.join('\n') },
      ],
    };
  }
}
