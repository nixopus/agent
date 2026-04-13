import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatPatternsBlock, type DeployPattern } from '../pattern-store';

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

describe('formatPatternsBlock', () => {
  it('returns empty string for no patterns', () => {
    expect(formatPatternsBlock([])).toBe('');
  });

  it('formats failure_fix patterns with confidence and hit count', () => {
    const patterns: DeployPattern[] = [{
      ecosystem: 'next.js',
      patternType: 'failure_fix',
      signature: 'Module not found: next/image',
      resolution: 'wrote:next.config.js',
      confidence: 0.85,
      hitCount: 12,
    }];
    const result = formatPatternsBlock(patterns);
    expect(result).toContain('[deploy-patterns]');
    expect(result).toContain('ecosystem:next.js');
    expect(result).toContain('known_fixes:');
    expect(result).toContain('Module not found: next/image');
    expect(result).toContain('wrote:next.config.js');
    expect(result).toContain('confidence:85%');
    expect(result).toContain('seen:12');
    expect(result).toContain('[/deploy-patterns]');
  });

  it('formats pitfall patterns', () => {
    const patterns: DeployPattern[] = [{
      ecosystem: 'react',
      patternType: 'pitfall',
      signature: 'Missing PORT env var',
      resolution: 'Add PORT=3000 to env',
      confidence: 0.7,
      hitCount: 5,
    }];
    const result = formatPatternsBlock(patterns);
    expect(result).toContain('pitfalls:');
    expect(result).toContain('Missing PORT env var');
    expect(result).toContain('confidence:70%');
  });

  it('formats fast_path patterns', () => {
    const patterns: DeployPattern[] = [{
      ecosystem: 'vite',
      patternType: 'fast_path',
      signature: 'Static SPA with dist/',
      resolution: 'Use static build_pack with dist as root',
      confidence: 0.95,
      hitCount: 30,
    }];
    const result = formatPatternsBlock(patterns);
    expect(result).toContain('fast_paths:');
    expect(result).toContain('Static SPA with dist/');
  });

  it('groups multiple pattern types together', () => {
    const patterns: DeployPattern[] = [
      { ecosystem: 'node', patternType: 'failure_fix', signature: 'ENOENT package.json', resolution: 'set correct root', confidence: 0.9, hitCount: 8 },
      { ecosystem: 'node', patternType: 'pitfall', signature: 'node_modules in image', resolution: 'add .dockerignore', confidence: 0.8, hitCount: 4 },
      { ecosystem: 'node', patternType: 'fast_path', signature: 'Express + Dockerfile', resolution: 'direct docker build', confidence: 0.95, hitCount: 20 },
    ];
    const result = formatPatternsBlock(patterns);
    expect(result).toContain('known_fixes:');
    expect(result).toContain('pitfalls:');
    expect(result).toContain('fast_paths:');
  });
});
