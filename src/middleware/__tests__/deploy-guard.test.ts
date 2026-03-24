import { describe, it, expect } from 'vitest';
import { isAgentStreamEndpoint, isDeployAgentStream } from '../deploy-guard';

describe('deploy-guard — isDeployAgentStream', () => {
  it('matches exact deploy agent stream path', () => {
    expect(isDeployAgentStream('/api/agents/deploy-agent/stream')).toBe(true);
  });

  it('matches path ending with deploy agent stream', () => {
    expect(isDeployAgentStream('/v2/agents/deploy-agent/stream')).toBe(true);
  });

  it('rejects non-deploy paths', () => {
    expect(isDeployAgentStream('/api/agents/codegen-agent/stream')).toBe(false);
    expect(isDeployAgentStream('/api/agents/deploy-agent')).toBe(false);
    expect(isDeployAgentStream('/api/agents/deploy-agent/run')).toBe(false);
    expect(isDeployAgentStream('/healthz')).toBe(false);
    expect(isDeployAgentStream('/')).toBe(false);
  });

  it('rejects paths that partially match', () => {
    expect(isDeployAgentStream('/api/agents/deploy-agent/stream/extra')).toBe(false);
    expect(isDeployAgentStream('/api/agents/deploy-agent/streaming')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isDeployAgentStream('')).toBe(false);
  });
});

describe('deploy-guard — isAgentStreamEndpoint', () => {
  it('matches any agent stream path', () => {
    expect(isAgentStreamEndpoint('/api/agents/deploy-agent/stream')).toBe(true);
    expect(isAgentStreamEndpoint('/api/agents/codegen-agent/stream')).toBe(true);
    expect(isAgentStreamEndpoint('/v2/agents/github-agent/stream')).toBe(true);
  });

  it('rejects non-stream agent paths', () => {
    expect(isAgentStreamEndpoint('/api/agents/deploy-agent')).toBe(false);
    expect(isAgentStreamEndpoint('/api/agents/deploy-agent/stream/extra')).toBe(false);
    expect(isAgentStreamEndpoint('/healthz')).toBe(false);
  });
});
