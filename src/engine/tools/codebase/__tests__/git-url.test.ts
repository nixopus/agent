import { describe, it, expect } from 'vitest';
import { extractGitUrlAndBranch, isPublicGitUrl, toCloneSafeHttpsUrl } from '../git-url';

describe('isPublicGitUrl', () => {
  it('accepts common public git URLs', () => {
    expect(isPublicGitUrl('https://github.com/acme/api.git')).toBe(true);
    expect(isPublicGitUrl('https://gitlab.com/acme/api')).toBe(true);
    expect(isPublicGitUrl('https://bitbucket.org/acme/api.git')).toBe(true);
  });

  it('rejects non-git URLs and scp-style URLs', () => {
    expect(isPublicGitUrl('https://example.com')).toBe(false);
    expect(isPublicGitUrl('git@github.com:acme/api.git')).toBe(false);
    expect(isPublicGitUrl('ftp://github.com/acme/api.git')).toBe(false);
  });

  it('rejects credential-bearing https URLs (userinfo)', () => {
    expect(isPublicGitUrl('https://token@github.com/acme/api.git')).toBe(false);
    expect(isPublicGitUrl('https://user:pass@github.com/acme/api.git')).toBe(false);
    expect(isPublicGitUrl('https://oauth2:secret@gitlab.com/acme/api.git')).toBe(false);
  });

  it('accepts valid repo URLs after stripping query and fragment', () => {
    expect(isPublicGitUrl('https://github.com/acme/api.git?ref=other')).toBe(true);
    expect(isPublicGitUrl('https://github.com/acme/api.git#readme')).toBe(true);
    expect(isPublicGitUrl('https://github.com/acme/api.git?ref=x#readme')).toBe(true);
  });
});

describe('toCloneSafeHttpsUrl', () => {
  it('returns https href without query or fragment', () => {
    expect(toCloneSafeHttpsUrl('https://github.com/acme/api.git?ref=other#readme')).toBe(
      'https://github.com/acme/api.git',
    );
  });

  it('returns null for non-https URLs', () => {
    expect(toCloneSafeHttpsUrl('git@github.com:acme/api.git')).toBeNull();
  });

  it('returns null for credential-bearing https URLs (userinfo)', () => {
    expect(toCloneSafeHttpsUrl('https://token@github.com/acme/api.git')).toBeNull();
    expect(toCloneSafeHttpsUrl('https://user:pass@github.com/acme/api.git')).toBeNull();
    expect(toCloneSafeHttpsUrl('https://oauth2:secret@gitlab.com/acme/api.git')).toBeNull();
  });
});

describe('extractGitUrlAndBranch', () => {
  it('extracts URL and branch from plain text', () => {
    expect(
      extractGitUrlAndBranch('deploy https://github.com/acme/api.git branch develop'),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'develop',
    });
  });

  it('extracts URL and leaves branch undefined when branch keyword is omitted', () => {
    const result = extractGitUrlAndBranch(
      'deploy https://github.com/acme/api.git for staging',
    );
    expect(result).toEqual({ url: 'https://github.com/acme/api.git' });
    expect(result?.branch).toBeUndefined();
  });

  it('returns null when no valid URL is present', () => {
    expect(extractGitUrlAndBranch('deploy my app')).toBeNull();
  });

  it('returns null when the matched URL embeds credentials (userinfo)', () => {
    expect(
      extractGitUrlAndBranch('deploy https://token@github.com/acme/api.git branch main'),
    ).toBeNull();
    expect(
      extractGitUrlAndBranch('deploy https://user:pass@github.com/acme/api.git'),
    ).toBeNull();
  });

  it('returns clone-safe URLs without query or fragment', () => {
    expect(
      extractGitUrlAndBranch(
        'use https://github.com/acme/api.git?ref=other#readme branch develop',
      ),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'develop',
    });
  });

  it('does not include trailing sentence punctuation in branch hints', () => {
    expect(
      extractGitUrlAndBranch('deploy https://github.com/acme/api.git branch main.'),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'main',
    });
  });

  it('keeps dots inside branch names when stripping trailing prose punctuation', () => {
    expect(
      extractGitUrlAndBranch('deploy https://github.com/acme/api.git branch release/1.0.'),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'release/1.0',
    });
  });

  it('strips angle-bracket markdown so the URL is clone-safe', () => {
    expect(
      extractGitUrlAndBranch('repo <https://github.com/acme/api.git> branch main'),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'main',
    });
  });

  it('strips square-bracket wrappers so the URL is clone-safe', () => {
    expect(
      extractGitUrlAndBranch('see [https://github.com/acme/api.git] for details'),
    ).toEqual({ url: 'https://github.com/acme/api.git' });
  });

  it('strips trailing semicolon glued from prose so the URL is clone-safe', () => {
    expect(
      extractGitUrlAndBranch('deploy https://github.com/acme/api.git; branch develop'),
    ).toEqual({
      url: 'https://github.com/acme/api.git',
      branch: 'develop',
    });
  });
});
