import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const httpProbeTool = createTool({
  id: 'http_probe',
  description:
    'Make an HTTP request to a URL to check if a deployed app responds. Returns status code, response time, headers, and a body preview. Use this to verify external reachability after deployment.',
  inputSchema: z.object({
    url: z.string().url(),
    method: z
      .enum(['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
      .optional()
      .describe('HTTP method. Defaults to GET.'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    timeout_ms: z
      .number()
      .optional()
      .describe('Request timeout in milliseconds. Defaults to 10000.'),
    follow_redirects: z
      .boolean()
      .optional()
      .describe('Whether to follow redirects. Defaults to true.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.number(),
    status_text: z.string(),
    response_time_ms: z.number(),
    headers: z.record(z.string(), z.string()),
    body_preview: z.string(),
    error: z.string().optional(),
    redirect_url: z.string().optional(),
  }),
  execute: async ({ url, method, headers, body, timeout_ms, follow_redirects }) => {
    const resolvedMethod = method ?? 'GET';
    const resolvedTimeout = timeout_ms ?? 10000;
    const resolvedFollowRedirects = follow_redirects ?? true;
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), resolvedTimeout);

      const res = await fetch(url, {
        method: resolvedMethod,
        headers: headers as HeadersInit | undefined,
        body: body || undefined,
        signal: controller.signal,
        redirect: resolvedFollowRedirects ? 'follow' : 'manual',
      });

      clearTimeout(timer);
      const elapsed = Date.now() - start;

      const text = await res.text().catch(() => '');
      const KEEP_HEADERS = ['content-type', 'location', 'server', 'x-powered-by', 'www-authenticate'];
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (KEEP_HEADERS.includes(k)) resHeaders[k] = v;
      });

      return {
        ok: res.ok,
        status: res.status,
        status_text: res.statusText,
        response_time_ms: elapsed,
        headers: resHeaders,
        body_preview: text.length > 500 ? text.slice(0, 500) + '...' : text,
        redirect_url: res.redirected ? res.url : undefined,
      };
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const message =
        err instanceof Error ? err.message : String(err);
      const isTimeout =
        message.includes('abort') || message.includes('timeout');
      return {
        ok: false,
        status: 0,
        status_text: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
        response_time_ms: elapsed,
        headers: {},
        body_preview: '',
        error: isTimeout
          ? `Request timed out after ${resolvedTimeout}ms`
          : message,
      };
    }
  },
});

export const httpTools = {
  httpProbe: httpProbeTool,
};
