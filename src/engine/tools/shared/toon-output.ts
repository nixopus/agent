import { encode } from '@toon-format/toon';
import { isWrappable } from './source-guard';

export function withToonOutput<T extends Record<string, unknown>>(tools: T): T {
  const result: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!isWrappable(tool)) {
      result[name] = tool;
      continue;
    }

    const origExecute = tool.execute as (...args: unknown[]) => Promise<unknown>;
    result[name] = {
      ...tool,
      execute: async (...args: unknown[]) => {
        const output = await origExecute(...args);
        if (output == null || typeof output !== 'object') return output;
        try {
          return encode(output as Record<string, unknown>);
        } catch {
          return output;
        }
      },
    };
  }

  return result as T;
}
