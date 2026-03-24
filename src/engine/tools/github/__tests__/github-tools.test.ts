import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalServiceError } from '../../../../errors';

const mockGithubFetch = vi.fn();
vi.mock('../../../../util/github-client', () => ({
  githubFetch: (...args: unknown[]) => mockGithubFetch(...args),
  getInstallationToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@nixopus/api-client', () => ({
  listGitHubConnectors: vi.fn().mockResolvedValue({
    data: { data: [{ id: 'c1', app_id: 'a1', pem: 'pem', installation_id: 'i1' }] },
  }),
}));

vi.mock('../../shared/nixopus-client', () => ({
  createNixopusClient: () => ({}),
}));

vi.mock('../../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { githubCreateOrUpdateFileTool } from '../github-tools';

const ctx = { requestContext: new Map([['organizationId', 'org-1']]) };

beforeEach(() => {
  mockGithubFetch.mockReset();
});

describe('github_create_or_update_file', () => {
  it('succeeds when sha is provided', async () => {
    mockGithubFetch.mockResolvedValue({
      content: { path: 'Dockerfile', sha: 'new-sha', html_url: 'https://x' },
      commit: { sha: 'commit-1', html_url: 'https://y' },
    });

    const result = await githubCreateOrUpdateFileTool.execute!(
      {
        owner: 'o',
        repo: 'r',
        path: 'Dockerfile',
        content: 'FROM node',
        message: 'update',
        sha: 'old-sha',
      },
      ctx as never,
    );

    expect(mockGithubFetch).toHaveBeenCalledTimes(1);
    expect(mockGithubFetch).toHaveBeenCalledWith(
      'mock-token',
      '/repos/o/r/contents/Dockerfile',
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ sha: 'old-sha' }),
      }),
    );
    expect(result).toMatchObject({ file_sha: 'new-sha' });
  });

  it('fetches sha when missing and file exists before updating', async () => {
    mockGithubFetch
      .mockResolvedValueOnce({
        name: 'Dockerfile',
        path: 'Dockerfile',
        sha: 'existing-sha',
        content: 'ZnJvbSBub2Rl',
        encoding: 'base64',
        size: 10,
        html_url: 'https://x',
      })
      .mockResolvedValueOnce({
        content: { path: 'Dockerfile', sha: 'new-sha', html_url: 'https://x' },
        commit: { sha: 'commit-1', html_url: 'https://y' },
      });

    const result = await githubCreateOrUpdateFileTool.execute!(
      {
        owner: 'o',
        repo: 'r',
        path: 'Dockerfile',
        content: 'FROM node:20',
        message: 'update',
        branch: 'main',
      },
      ctx as never,
    );

    expect(mockGithubFetch).toHaveBeenCalledTimes(2);
    expect(mockGithubFetch).toHaveBeenNthCalledWith(
      1,
      'mock-token',
      '/repos/o/r/contents/Dockerfile',
      expect.objectContaining({ query: { ref: 'main' } }),
    );
    expect(mockGithubFetch).toHaveBeenNthCalledWith(
      2,
      'mock-token',
      '/repos/o/r/contents/Dockerfile',
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ sha: 'existing-sha', branch: 'main' }),
      }),
    );
    expect(result).toMatchObject({ file_sha: 'new-sha' });
  });

  it('creates new file without sha when file does not exist', async () => {
    mockGithubFetch.mockRejectedValueOnce(
      new ExternalServiceError('github', 'GitHub API GET /repos/o/r/contents/Dockerfile failed (404): Not Found', 404),
    );
    mockGithubFetch.mockResolvedValueOnce({
      content: { path: 'Dockerfile', sha: 'new-sha', html_url: 'https://x' },
      commit: { sha: 'commit-1', html_url: 'https://y' },
    });

    const result = await githubCreateOrUpdateFileTool.execute!(
      {
        owner: 'o',
        repo: 'r',
        path: 'Dockerfile',
        content: 'FROM node',
        message: 'add',
        branch: 'main',
      },
      ctx as never,
    );

    expect(mockGithubFetch).toHaveBeenCalledTimes(2);
    const putCall = mockGithubFetch.mock.calls[1];
    expect(putCall[2].body).not.toHaveProperty('sha');
    expect(putCall[2].body.branch).toBe('main');
    expect(result).toMatchObject({ file_sha: 'new-sha' });
  });
});
