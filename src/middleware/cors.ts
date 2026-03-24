import { config } from '../config';

const CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
const CORS_EXPOSE_HEADERS = 'Authorization, X-Organization-Id, x-organization-id, X-Credits-Remaining, X-Machine-Warning, X-Machine-Grace-Deadline, X-Machine-Days-Remaining';
const BASE_ALLOWED_HEADERS = new Set([
  'Content-Type', 'Authorization',
  'X-Session-ID', 'x-session-id', 'X-Organization-Id', 'x-organization-id',
  'X-Model-Id', 'x-api-key',
]);

export function setCorsHeaders(
  c: { header: (name: string, value: string) => void; req: { header: (name: string) => string | undefined } },
): void {
  const origin = c.req.header('Origin');
  const origins = config.allowedOrigin;
  const allowedOrigin = (origin && origins.includes(origin)) ? origin : origins[0] ?? null;
  if (!allowedOrigin) return;

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Methods', CORS_METHODS);
  const reqHeaders = c.req.header('Access-Control-Request-Headers');
  const headers = reqHeaders
    ? new Set([...BASE_ALLOWED_HEADERS, ...reqHeaders.split(',').map((h) => h.trim())])
    : BASE_ALLOWED_HEADERS;
  c.header('Access-Control-Allow-Headers', Array.from(headers).join(', '));
  c.header('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
  c.header('Access-Control-Max-Age', '300');
}
