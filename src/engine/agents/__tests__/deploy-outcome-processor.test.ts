import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MastraDBMessage } from '@mastra/core/agent';

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { DeployOutcomeProcessor, extractOutcome } from '../deploy-outcome-processor';
import { PatternStore } from '../pattern-store';

function userMsg(text: string): MastraDBMessage {
  return { role: 'user', content: text, id: '1', createdAt: new Date(), threadId: 't1', type: 'text' } as MastraDBMessage;
}

function toolMsg(toolName: string, output: Record<string, unknown> | string, input?: Record<string, unknown>): MastraDBMessage {
  return {
    role: 'assistant',
    content: {
      parts: [{
        type: 'tool-result',
        toolName,
        output: typeof output === 'string' ? output : JSON.stringify(output),
        input: input ? JSON.stringify(input) : undefined,
      }],
    },
    id: `${Math.random()}`,
    createdAt: new Date(),
    threadId: 't1',
    type: 'text',
  } as unknown as MastraDBMessage;
}

describe('extractOutcome', () => {
  it('returns null when no deploy tool was invoked', () => {
    const msgs = [userMsg('hello'), toolMsg('getApplications', { data: [] })];
    expect(extractOutcome(msgs)).toBeNull();
  });

  it('returns null when no ecosystem detected', () => {
    const msgs = [
      userMsg('deploy this'),
      toolMsg('deployProject', { status: 'running', applicationId: 'abc-123' }),
    ];
    expect(extractOutcome(msgs)).toBeNull();
  });

  it('extracts successful deploy outcome', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running', id: '550e8400-e29b-41d4-a716-446655440000' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    const result = extractOutcome(msgs);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('success');
    expect(result!.ecosystem).toBe('next.js');
    expect(result!.applicationId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('extracts failed deploy outcome with failure signatures', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentLogs', 'error: Module not found: next/image\nfailed to compile'),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
    ];
    const result = extractOutcome(msgs);
    expect(result!.outcome).toBe('failed');
    expect(result!.failureSignatures.length).toBeGreaterThan(0);
    expect(result!.failureSignatures.some((s) => s.includes('Module not found'))).toBe(true);
  });

  it('extracts fixes applied from writeWorkspaceFiles', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
      toolMsg('writeWorkspaceFiles', { ok: true }, { path: 'next.config.js' }),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    const result = extractOutcome(msgs);
    expect(result!.fixesApplied.length).toBeGreaterThan(0);
    expect(result!.fixesApplied[0]).toContain('next.config.js');
  });

  it('detects rollback outcome', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
      toolMsg('rollbackDeployment', { status: 'running' }),
      { role: 'assistant', content: 'Rollback completed successfully.', id: '3', createdAt: new Date(), threadId: 't1', type: 'text' } as MastraDBMessage,
    ];
    const result = extractOutcome(msgs);
    expect(result!.outcome).toBe('rollback');
  });

  it('counts self-heal attempts from redeploy/recover/rollback', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
      toolMsg('redeployApplication', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
      toolMsg('rollbackDeployment', { status: 'running' }),
    ];
    const result = extractOutcome(msgs);
    expect(result!.selfHealAttempts).toBe(2);
  });

  it('caps self-heal attempts at 3', () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('redeployApplication', {}),
      toolMsg('redeployApplication', {}),
      toolMsg('recoverApplication', {}),
      toolMsg('rollbackDeployment', {}),
    ];
    const result = extractOutcome(msgs);
    expect(result!.selfHealAttempts).toBe(3);
  });
});

describe('DeployOutcomeProcessor', () => {
  let processor: DeployOutcomeProcessor;
  let mockStore: {
    recordOutcome: ReturnType<typeof vi.fn>;
    upsertPattern: ReturnType<typeof vi.fn>;
    getPatterns: ReturnType<typeof vi.fn>;
  };

  function makeOutputArgs(msgs: MastraDBMessage[], orgId?: string) {
    const store = new Map<string, unknown>();
    if (orgId) store.set('orgId', orgId);
    return {
      messages: msgs,
      requestContext: { get: (k: string) => store.get(k) } as any,
      result: { text: '', usage: {}, finishReason: 'stop', steps: [] },
      state: {},
      abort: (() => { throw new Error('abort'); }) as never,
      retryCount: 0,
      messageList: {} as any,
    };
  }

  beforeEach(() => {
    processor = new DeployOutcomeProcessor();
    mockStore = {
      recordOutcome: vi.fn(),
      upsertPattern: vi.fn(),
      getPatterns: vi.fn(),
    };
    processor.setPatternStore(mockStore as unknown as PatternStore);
  });

  it('skips recording when no deploy happened', async () => {
    const msgs = [userMsg('hello')];
    await processor.processOutputResult(makeOutputArgs(msgs) as any);
    expect(mockStore.recordOutcome).not.toHaveBeenCalled();
  });

  it('records successful outcome', async () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running', id: '550e8400-e29b-41d4-a716-446655440000' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    await processor.processOutputResult(makeOutputArgs(msgs, 'org-1') as any);

    expect(mockStore.recordOutcome).toHaveBeenCalledTimes(1);
    expect(mockStore.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        ecosystem: 'next.js',
        outcome: 'success',
      }),
    );
  });

  it('records outcome and upserts patterns on failure with fixes', async () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentLogs', 'error: Module not found: next/image'),
      toolMsg('writeWorkspaceFiles', { ok: true }, { path: 'next.config.js' }),
      toolMsg('getDeploymentById', { status: 'build_failed' }),
    ];
    await processor.processOutputResult(makeOutputArgs(msgs) as any);

    expect(mockStore.recordOutcome).toHaveBeenCalledTimes(1);
    expect(mockStore.upsertPattern).toHaveBeenCalled();
    expect(mockStore.upsertPattern).toHaveBeenCalledWith(
      'next.js',
      'failure_fix',
      expect.any(String),
      expect.stringContaining('next.config.js'),
      false,
    );
  });

  it('upserts patterns as succeeded when fix led to success', async () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentLogs', 'error: Module not found: next/image'),
      toolMsg('writeWorkspaceFiles', { ok: true }, { path: 'next.config.js' }),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    await processor.processOutputResult(makeOutputArgs(msgs) as any);

    expect(mockStore.upsertPattern).toHaveBeenCalledWith(
      'next.js',
      'failure_fix',
      expect.any(String),
      expect.stringContaining('next.config.js'),
      true,
    );
  });

  it('does not upsert patterns when no failures and no fixes', async () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    await processor.processOutputResult(makeOutputArgs(msgs) as any);

    expect(mockStore.recordOutcome).toHaveBeenCalled();
    expect(mockStore.upsertPattern).not.toHaveBeenCalled();
  });

  it('handles store errors gracefully without throwing', async () => {
    mockStore.recordOutcome.mockRejectedValue(new Error('db error'));
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
      toolMsg('getDeploymentById', { status: 'running' }),
    ];
    await expect(
      processor.processOutputResult(makeOutputArgs(msgs) as any),
    ).resolves.not.toThrow();
  });

  it('returns messages unchanged', async () => {
    const msgs = [
      userMsg('Deploy my Next.js app'),
      toolMsg('deployProject', { status: 'running' }),
    ];
    const result = await processor.processOutputResult(makeOutputArgs(msgs) as any);
    expect(result).toBe(msgs);
  });
});
