import { describe, it, expect } from 'vitest';
import { suggestionAgent } from '../suggestion-agent';

describe('suggestion-agent', () => {
  it('has the correct id', () => {
    expect(suggestionAgent.id).toBe('suggestion-agent');
  });

  it('has the correct name', () => {
    expect(suggestionAgent.name).toBe('Suggestion Agent');
  });

  it('has only read-only tools', () => {
    const toolNames = Object.keys(suggestionAgent.tools ?? {});
    expect(toolNames).toContain('getApplications');
    expect(toolNames).toContain('getGithubRepositories');
    expect(toolNames).toContain('getServers');
    expect(toolNames).toContain('getDomains');
    expect(toolNames).toContain('listContainers');
    expect(toolNames).toHaveLength(5);
  });

  it('does not have any mutating tools', () => {
    const toolNames = Object.keys(suggestionAgent.tools ?? {});
    const mutatingPatterns = ['create', 'update', 'delete', 'deploy', 'restart', 'rollback', 'remove'];
    for (const name of toolNames) {
      const lower = name.toLowerCase();
      for (const pattern of mutatingPatterns) {
        expect(lower).not.toContain(pattern);
      }
    }
  });

  it('has instructions mentioning JSON output', () => {
    const instructions = typeof suggestionAgent.instructions === 'string'
      ? suggestionAgent.instructions
      : '';
    expect(instructions).toContain('suggestions');
    expect(instructions).toContain('JSON');
  });
});
