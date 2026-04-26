import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { DeployFlowInjector, SAMPLE_APP_CONFIGS, matchSampleApp, getLastUserText } from '../deploy-flow-injector';

function makeReqCtx() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => void store.set(k, v),
  };
}

function userMsg(text: string, id = 'u1'): MastraDBMessage {
  return {
    role: 'user',
    content: text,
    id,
    createdAt: new Date(),
    threadId: 't1',
    type: 'text',
  } as MastraDBMessage;
}

function makeArgs(message: string, opts?: { stepNumber?: number; rc?: ReturnType<typeof makeReqCtx> }): ProcessInputStepArgs {
  return {
    stepNumber: opts?.stepNumber ?? 0,
    messages: [userMsg(message)],
    systemMessages: [],
    requestContext: (opts?.rc ?? makeReqCtx()) as unknown as ProcessInputStepArgs['requestContext'],
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

describe('matchSampleApp', () => {
  it('matches nixopus/sample-app HTTPS URL', () => {
    expect(matchSampleApp('deploy https://github.com/nixopus/sample-app')).not.toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(matchSampleApp('deploy https://GitHub.com/Nixopus/Sample-App')).not.toBeNull();
  });

  it('matches URL with .git suffix', () => {
    expect(matchSampleApp('deploy https://github.com/nixopus/sample-app.git')).not.toBeNull();
  });

  it('does not match unrelated repos', () => {
    expect(matchSampleApp('deploy https://github.com/someuser/my-app')).toBeNull();
  });

  it('does not match without a URL', () => {
    expect(matchSampleApp('deploy my app please')).toBeNull();
  });
});

describe('getLastUserText', () => {
  it('returns the last user message text', () => {
    const messages = [
      userMsg('first message', 'u1'),
      { role: 'assistant', content: 'response', id: 'a1', createdAt: new Date(), threadId: 't1', type: 'text' } as MastraDBMessage,
      userMsg('deploy https://github.com/nixopus/sample-app', 'u2'),
    ];
    expect(getLastUserText(messages)).toBe('deploy https://github.com/nixopus/sample-app');
  });

  it('returns empty string when no user messages', () => {
    expect(getLastUserText([])).toBe('');
  });
});

describe('DeployFlowInjector', () => {
  let injector: DeployFlowInjector;

  beforeEach(() => {
    injector = new DeployFlowInjector();
  });

  it('injects sample app fast-path when user message contains sample app URL', () => {
    const args = makeArgs('deploy https://github.com/nixopus/sample-app');
    const result = injector.processInputStep(args);

    expect(result.systemMessages).toBeDefined();
    expect(result.systemMessages!.length).toBeGreaterThan(0);

    const injected = result.systemMessages![0];
    expect(injected.content).toContain('[sample-app-fast-path]');
    expect(injected.content).toContain('quickDeploy');
    expect(injected.content).toContain('port: 3000');
  });

  it('includes the actual URL from user message in the recipe', () => {
    const url = 'https://github.com/nixopus/sample-app.git';
    const args = makeArgs(`deploy ${url}`);
    const result = injector.processInputStep(args);

    const injected = result.systemMessages![0];
    expect(injected.content).toContain(url);
  });

  it('does not inject fast-path for non-sample repos', () => {
    const args = makeArgs('deploy https://github.com/someuser/my-app');
    const result = injector.processInputStep(args);

    if (result.systemMessages && result.systemMessages.length > 0) {
      const injected = result.systemMessages[0];
      expect(injected.content).toContain('[deploy-flow]');
      expect(injected.content).not.toMatch(/^\[sample-app-fast-path\]/);
    }
  });

  it('skips injection on non-zero stepNumber', () => {
    const args = makeArgs('deploy https://github.com/nixopus/sample-app', { stepNumber: 1 });
    const result = injector.processInputStep(args);
    expect(result.systemMessages ?? []).toEqual([]);
  });

  it('skips injection when already injected in the same request', () => {
    const rc = makeReqCtx();
    const args1 = makeArgs('deploy https://github.com/nixopus/sample-app', { rc });
    injector.processInputStep(args1);

    const args2 = makeArgs('deploy https://github.com/nixopus/sample-app', { rc, stepNumber: 0 });
    const result2 = injector.processInputStep(args2);
    expect(result2.systemMessages ?? []).toEqual([]);
  });

  it('skips injection when no deploy intent', () => {
    const args = makeArgs('what is nixopus?');
    const result = injector.processInputStep(args);
    expect(result.systemMessages ?? []).toEqual([]);
  });

  it('fast-path recipe tells agent not to load skills', () => {
    const args = makeArgs('deploy https://github.com/nixopus/sample-app');
    const result = injector.processInputStep(args);

    const injected = result.systemMessages![0];
    expect(injected.content).toContain('HIGHEST PRIORITY');
    expect(injected.content).toContain('FORBIDDEN tools');
  });
});

describe('SAMPLE_APP_CONFIGS', () => {
  it('has at least one sample app configured', () => {
    expect(SAMPLE_APP_CONFIGS.length).toBeGreaterThan(0);
  });

  it('nixopus sample app config has correct properties', () => {
    const config = SAMPLE_APP_CONFIGS[0];
    expect(config.name).toBe('Nixopus Sample App');
    expect(config.port).toBe(3000);
    expect(config.buildPack).toBe('dockerfile');
    expect(config.branch).toBe('main');
  });
});
