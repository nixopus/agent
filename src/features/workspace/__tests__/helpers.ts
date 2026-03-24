export function appId(n = 1): string {
  return `app-${String(n).padStart(8, '0')}`;
}

export function makeFiles(
  count: number,
  opts?: { sizeBytes?: number; language?: string; prefix?: string },
): Array<{ path: string; content: string; language?: string }> {
  const size = opts?.sizeBytes ?? 50;
  const prefix = opts?.prefix ?? 'src/mod';
  return Array.from({ length: count }, (_, i) => ({
    path: `${prefix}${Math.floor(i / 100)}/file${i}.ts`,
    content: `export function fn${i}() { return ${i}; }\n${'x'.repeat(Math.max(0, size - 40))}`,
    language: opts?.language ?? 'typescript',
  }));
}

export function makeDeepPath(depth: number): string {
  return Array.from({ length: depth }, (_, i) => `d${i}`).join('/') + '/file.ts';
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const S3_CONFIG = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  endpoint: 'https://s3.test.local',
} as const;
