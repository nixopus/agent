import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { DeployPatternProcessor, detectEcosystemFromMessages } from '../deploy-pattern-processor';
import { PatternStore, type DeployPattern } from '../pattern-store';

function makeReqCtx(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(overrides));
  return { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v) };
}

function makeArgs(msgs: MastraDBMessage[], rc?: ReturnType<typeof makeReqCtx>): ProcessInputStepArgs {
  return {
    stepNumber: 0,
    messages: msgs,
    systemMessages: [],
    requestContext: (rc ?? makeReqCtx()) as unknown as ProcessInputStepArgs['requestContext'],
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

function userMsg(text: string): MastraDBMessage {
  return { role: 'user', content: text, id: '1', createdAt: new Date(), threadId: 't1', type: 'text' } as MastraDBMessage;
}

function toolResultMsg(toolName: string, output: string): MastraDBMessage {
  return {
    role: 'assistant',
    content: { parts: [{ type: 'tool-result', toolName, output }] },
    id: '2',
    createdAt: new Date(),
    threadId: 't1',
    type: 'text',
  } as unknown as MastraDBMessage;
}

describe('detectEcosystemFromMessages', () => {
  it('detects Next.js from user message', () => {
    expect(detectEcosystemFromMessages([userMsg('Deploy my Next.js app')])).toBe('next.js');
  });

  it('detects Django from user message', () => {
    expect(detectEcosystemFromMessages([userMsg('I have a Django project')])).toBe('django');
  });

  it('detects ecosystem from tool result containing config file', () => {
    expect(detectEcosystemFromMessages([
      toolResultMsg('analyzeRepository', '{"files": ["next.config.js", "package.json"]}'),
    ])).toBe('next.js');
  });

  it('returns null when no ecosystem detected', () => {
    expect(detectEcosystemFromMessages([userMsg('hello')])).toBeNull();
  });

  it('prioritizes latest messages (scans backwards)', () => {
    const msgs = [
      userMsg('I used to use Django'),
      userMsg('Now deploy my Next.js app'),
    ];
    expect(detectEcosystemFromMessages(msgs)).toBe('next.js');
  });
});

describe('DeployPatternProcessor', () => {
  let processor: DeployPatternProcessor;
  let mockStore: { getPatterns: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    processor = new DeployPatternProcessor();
    mockStore = { getPatterns: vi.fn(), recordOutcome: vi.fn(), upsertPattern: vi.fn() };
    processor.setPatternStore(mockStore as unknown as PatternStore);
  });

  it('returns empty when no pattern store is set', async () => {
    const bare = new DeployPatternProcessor();
    const result = await bare.processInputStep(makeArgs([userMsg('Deploy my Next.js app')]));
    expect(result).toEqual({});
  });

  it('returns empty when no ecosystem detected', async () => {
    const result = await processor.processInputStep(makeArgs([userMsg('hello')]));
    expect(result).toEqual({});
    expect(mockStore.getPatterns).not.toHaveBeenCalled();
  });

  it('queries patterns and injects system message when ecosystem detected', async () => {
    const patterns: DeployPattern[] = [{
      ecosystem: 'next.js',
      patternType: 'failure_fix',
      signature: 'Module not found',
      resolution: 'fix config',
      confidence: 0.9,
      hitCount: 5,
    }];
    mockStore.getPatterns.mockResolvedValue(patterns);

    const result = await processor.processInputStep(makeArgs([userMsg('Deploy my Next.js app')]));
    expect(mockStore.getPatterns).toHaveBeenCalledWith('next.js');

    const sysMsg = (result as { systemMessages?: Array<{ content: string }> }).systemMessages;
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.length).toBe(1);
    expect(sysMsg![0].content).toContain('[deploy-patterns]');
    expect(sysMsg![0].content).toContain('Module not found');
  });

  it('returns empty when patterns exist but are empty', async () => {
    mockStore.getPatterns.mockResolvedValue([]);
    const result = await processor.processInputStep(makeArgs([userMsg('Deploy my Next.js app')]));
    expect(result).toEqual({});
  });

  it('caches results across steps via requestContext', async () => {
    mockStore.getPatterns.mockResolvedValue([{
      ecosystem: 'next.js',
      patternType: 'failure_fix',
      signature: 'err',
      resolution: 'fix',
      confidence: 0.9,
      hitCount: 1,
    }]);

    const rc = makeReqCtx();
    const args1 = makeArgs([userMsg('Deploy my Next.js app')], rc);
    await processor.processInputStep(args1);

    const args2 = makeArgs([userMsg('Deploy my Next.js app')], rc);
    const result2 = await processor.processInputStep(args2);

    expect(mockStore.getPatterns).toHaveBeenCalledTimes(1);
    const sysMsg = (result2 as { systemMessages?: Array<{ content: string }> }).systemMessages;
    expect(sysMsg![0].content).toContain('[deploy-patterns]');
  });

  it('handles store errors gracefully', async () => {
    mockStore.getPatterns.mockRejectedValue(new Error('db down'));
    const result = await processor.processInputStep(makeArgs([userMsg('Deploy my Next.js app')]));
    expect(result).toEqual({});
  });
});
