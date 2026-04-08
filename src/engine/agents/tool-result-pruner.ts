import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';

const TRANSIENT_TOOLS = new Set([
  'search_tools',
  'load_tool',
]);

const SUMMARY_PLACEHOLDER = '[pruned — transient discovery result]';

function isToolResultForTransient(part: Record<string, unknown>): boolean {
  if (part.type !== 'tool-invocation' && part.type !== 'tool-result') return false;
  const toolName = (part.toolName ?? part.toolCallName ?? '') as string;
  return TRANSIENT_TOOLS.has(toolName);
}

function pruneMessage(msg: MastraDBMessage): MastraDBMessage | null {
  const content = msg?.content as Record<string, unknown> | undefined;
  if (!content) return msg;

  const parts = content.parts as unknown[] | undefined;
  if (!parts || !Array.isArray(parts)) return msg;

  let changed = false;
  const newParts = parts.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const part = raw as Record<string, unknown>;
    if (!isToolResultForTransient(part)) return raw;
    if (part.state === 'result' || part.type === 'tool-result') {
      changed = true;
      return { ...part, output: SUMMARY_PLACEHOLDER, result: SUMMARY_PLACEHOLDER };
    }
    return raw;
  });

  if (!changed) return msg;

  return {
    ...msg,
    content: { ...content, parts: newParts },
  } as MastraDBMessage;
}

export class ToolResultPruner implements Processor<'tool-result-pruner'> {
  readonly id = 'tool-result-pruner' as const;
  readonly name = 'Tool Result Pruner';

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    if (args.stepNumber < 2) return {};

    const messages = args.messages;
    if (!messages || !Array.isArray(messages)) return {};

    let mutated = false;
    const result: MastraDBMessage[] = new Array(messages.length);
    for (let i = 0; i < messages.length; i++) {
      const pruned = pruneMessage(messages[i]);
      if (pruned !== messages[i] && pruned !== null) {
        result[i] = pruned;
        mutated = true;
      } else {
        result[i] = messages[i];
      }
    }

    if (!mutated) return {};
    return { messages: result };
  }
}
