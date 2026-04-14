import { describe, it, expect } from 'vitest';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { DeployStateProcessor } from '../deploy-state-processor';

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

function makeArgs(message: string, rc = makeReqCtx()): ProcessInputStepArgs {
  return {
    stepNumber: 0,
    messages: [userMsg(message)],
    systemMessages: [],
    requestContext: rc as unknown as ProcessInputStepArgs['requestContext'],
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
    abort: (() => {
      throw new Error('abort');
    }) as never,
    tracingContext: {} as never,
    messageList: {} as never,
  };
}

describe('DeployStateProcessor workspace context', () => {
  it('stores git_url workspace source, sync target, workspace id, and branch on requestContext', () => {
    const processor = new DeployStateProcessor();
    const rc = makeReqCtx();
    const args = makeArgs(
      'deploy this [context: source=git_url syncTarget=11111111-1111-1111-1111-111111111111 workspaceId=22222222-2222-2222-2222-222222222222 branch=main]',
      rc,
    );
    processor.processInputStep(args);
    expect(rc.get('workspaceSource')).toBe('git_url');
    expect(rc.get('syncTarget')).toBe('11111111-1111-1111-1111-111111111111');
    expect(rc.get('workspaceId')).toBe('22222222-2222-2222-2222-222222222222');
    expect(rc.get('contextBranch')).toBe('main');
  });

  it('stores applicationId from context as contextApplicationId', () => {
    const processor = new DeployStateProcessor();
    const rc = makeReqCtx();
    const appId = '33333333-3333-3333-3333-333333333333';
    const args = makeArgs(
      `prep [context: source=git_url applicationId=${appId} syncTarget=11111111-1111-1111-1111-111111111111]`,
      rc,
    );
    processor.processInputStep(args);
    expect(rc.get('workspaceSource')).toBe('git_url');
    expect(rc.get('contextApplicationId')).toBe(appId);
    expect(rc.get('syncTarget')).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('parses comma-separated context fields (with trailing comma)', () => {
    const processor = new DeployStateProcessor();
    const rc = makeReqCtx();
    const args = makeArgs(
      'deploy [context: source=git_url, branch=main, syncTarget=11111111-1111-1111-1111-111111111111, workspaceId=22222222-2222-2222-2222-222222222222,]',
      rc,
    );
    processor.processInputStep(args);
    expect(rc.get('workspaceSource')).toBe('git_url');
    expect(rc.get('contextBranch')).toBe('main');
    expect(rc.get('syncTarget')).toBe('11111111-1111-1111-1111-111111111111');
    expect(rc.get('workspaceId')).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('parses multiline context blocks with line breaks between fields', () => {
    const processor = new DeployStateProcessor();
    const rc = makeReqCtx();
    const args = makeArgs(
      `Deploy from URL
[context:
  source=git_url
  syncTarget=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
  workspaceId=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
  branch=develop
]`,
      rc,
    );
    processor.processInputStep(args);
    expect(rc.get('workspaceSource')).toBe('git_url');
    expect(rc.get('syncTarget')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(rc.get('workspaceId')).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(rc.get('contextBranch')).toBe('develop');
  });

  it('uses the latest user message that contains a context block', () => {
    const processor = new DeployStateProcessor();
    const rc = makeReqCtx();
    const args = makeArgs('', rc);
    args.messages = [
      userMsg('[context: source=s3 syncTarget=00000000-0000-0000-0000-000000000001]', 'older'),
      userMsg('[context: source=git_url syncTarget=11111111-1111-1111-1111-111111111111]', 'newer'),
    ];
    processor.processInputStep(args);
    expect(rc.get('workspaceSource')).toBe('git_url');
    expect(rc.get('syncTarget')).toBe('11111111-1111-1111-1111-111111111111');
  });
});
