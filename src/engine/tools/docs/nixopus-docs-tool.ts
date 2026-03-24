import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const DOCS_BASE_URL = 'https://docs.nixopus.com';
const LLMS_TXT_URL = `${DOCS_BASE_URL}/llms.txt`;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_LENGTH = 30_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text: text.length > MAX_BODY_LENGTH ? text.slice(0, MAX_BODY_LENGTH) + '\n\n[truncated]' : text,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, text: '', error: message };
  }
}

export const fetchNixopusDocsIndexTool = createTool({
  id: 'fetch_nixopus_docs_index',
  description:
    'Fetch the Nixopus documentation index (llms.txt) which lists all available doc pages with descriptions. Use this first to discover which page has the information you need before fetching a specific page.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const result = await fetchWithTimeout(LLMS_TXT_URL, FETCH_TIMEOUT_MS);
    if (!result.ok) {
      return { ok: false, content: '', error: result.error ?? `HTTP ${result.status}` };
    }
    return { ok: true, content: result.text };
  },
});

export const fetchNixopusDocsPageTool = createTool({
  id: 'fetch_nixopus_docs_page',
  description:
    'Fetch a specific Nixopus documentation page by its path. The path comes from the docs index (llms.txt). Returns the full markdown content of that page.',
  inputSchema: z.object({
    path: z
      .string()
      .describe('The doc page path from the index, e.g. "getting-started/quickstart.md" or "concepts/deployments.md"'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    url: z.string(),
    content: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ path }) => {
    const cleanPath = path.replace(/^\/+/, '');
    const url = `${DOCS_BASE_URL}/${cleanPath}`;
    const result = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!result.ok) {
      return { ok: false, url, content: '', error: result.error ?? `HTTP ${result.status}` };
    }
    return { ok: true, url, content: result.text };
  },
});

export const nixopusDocsTools = {
  fetchNixopusDocsIndex: fetchNixopusDocsIndexTool,
  fetchNixopusDocsPage: fetchNixopusDocsPageTool,
};
