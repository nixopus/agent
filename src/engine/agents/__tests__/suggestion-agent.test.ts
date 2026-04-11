import { describe, it, expect } from 'vitest';
import { suggestionAgent } from '../suggestion-agent';

describe('suggestion-agent', () => {
  it('has the correct id', () => {
    expect(suggestionAgent.id).toBe('suggestion-agent');
  });

  it('has the correct name', () => {
    expect(suggestionAgent.name).toBe('Suggestion Agent');
  });

  it('has no tools (entities provided via context)', () => {
    const toolNames = Object.keys(suggestionAgent.tools ?? {});
    expect(toolNames).toHaveLength(0);
  });
});
