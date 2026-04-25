import { describe, it, expect } from 'vitest';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { ToolBudgetProcessor } from '../tool-budget-processor';

function makeReqCtx(store: Record<string, unknown> = {}) {
  return {
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
    },
  };
}

function toolMsg(toolName: string): MastraDBMessage {
  return {
    role: 'assistant',
    content: {
      parts: [
        { type: 'tool-invocation', toolName, input: {}, state: 'result', output: {} },
      ],
    },
    id: 'a1',
    createdAt: new Date(),
    threadId: 't1',
    type: 'text',
  } as unknown as MastraDBMessage;
}

function makeArgs(opts: {
  stepNumber: number;
  messages?: MastraDBMessage[];
  store?: Record<string, unknown>;
}): ProcessInputStepArgs {
  return {
    stepNumber: opts.stepNumber,
    messages: opts.messages ?? [],
    systemMessages: [],
    requestContext: makeReqCtx(opts.store ?? {}) as unknown as ProcessInputStepArgs['requestContext'],
    steps: [],
    model: {} as never,
    toolChoice: 'auto' as const,
    activeTools: [],
    tools: {},
    providerOptions: {},
    modelSettings: {},
    structuredOutput: undefined,
    state: {},
    retryCount: 0,
    abort: (() => { throw new Error('abort'); }) as never,
    tracingContext: {} as never,
    messageList: {} as never,
  };
}

describe('ToolBudgetProcessor', () => {
  it('injects no message before 50% of steps', () => {
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 10 }));
    expect(result.systemMessages ?? []).toEqual([]);
  });

  it('injects "be efficient" at 50% of steps', () => {
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 50 }));

    expect(result.systemMessages).toBeDefined();
    expect(result.systemMessages!.length).toBe(1);
    expect(result.systemMessages![0].content).toContain('step=50/100');
    expect(result.systemMessages![0].content).toContain('be efficient');
  });

  it('injects "wrap up" at 75% of steps', () => {
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 78 }));

    expect(result.systemMessages![0].content).toContain('step=78/100');
    expect(result.systemMessages![0].content).toContain('wrap up');
  });

  it('injects CRITICAL at 90%+ of steps', () => {
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 95 }));

    expect(result.systemMessages![0].content).toContain('step=95/100');
    expect(result.systemMessages![0].content).toContain('CRITICAL');
  });

  it('respects custom maxSteps', () => {
    const processor = new ToolBudgetProcessor(20);
    const result = processor.processInputStep(makeArgs({ stepNumber: 10 }));

    expect(result.systemMessages).toBeDefined();
    expect(result.systemMessages![0].content).toContain('step=10/20');
  });

  it('includes tool-efficiency warnings from governor state', () => {
    const store: Record<string, unknown> = {
      governorState: {
        calls: new Map(),
        warnings: ['getApplications: 4 calls (advisory limit: 2). Reuse data from prior calls.'],
      },
    };
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 60, store }));

    expect(result.systemMessages![0].content).toContain('[tool-efficiency]');
    expect(result.systemMessages![0].content).toContain('getApplications');
  });

  it('clears warnings after injection', () => {
    const warnings = ['some warning'];
    const store: Record<string, unknown> = {
      governorState: { calls: new Map(), warnings },
    };
    const processor = new ToolBudgetProcessor(100);
    processor.processInputStep(makeArgs({ stepNumber: 60, store }));

    expect(warnings).toEqual([]);
  });

  it('includes tools_used count when tool calls exist in messages', () => {
    const processor = new ToolBudgetProcessor(100);
    const messages = [toolMsg('getApplications'), toolMsg('getDeploymentById')];
    const result = processor.processInputStep(makeArgs({ stepNumber: 55, messages }));

    expect(result.systemMessages![0].content).toContain('tools_used=2');
  });

  it('works when no governor state exists', () => {
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 60 }));

    expect(result.systemMessages).toBeDefined();
    expect(result.systemMessages![0].content).toContain('be efficient');
    expect(result.systemMessages![0].content).not.toContain('[tool-efficiency]');
  });

  it('injects only efficiency warnings when below 50% but warnings exist', () => {
    const store: Record<string, unknown> = {
      governorState: {
        calls: new Map(),
        warnings: ['someTool: 5 calls (advisory limit: 3). Reuse data from prior calls.'],
      },
    };
    const processor = new ToolBudgetProcessor(100);
    const result = processor.processInputStep(makeArgs({ stepNumber: 10, store }));

    expect(result.systemMessages).toBeDefined();
    expect(result.systemMessages![0].content).toContain('[tool-efficiency]');
    expect(result.systemMessages![0].content).not.toContain('[tool-budget]');
  });
});
