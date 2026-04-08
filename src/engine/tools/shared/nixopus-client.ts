import { createClient } from '@hey-api/client-fetch';
import { AuthenticationError } from '../../../errors';
import { config } from '../../../config';

const rawBase = config.apiUrl || 'http://localhost:8080';
const API_BASE_URL = rawBase.replace(/\/api\/?$/i, '') || rawBase;

export type NixopusRequestContext = {
  get?: (key: string) => string | undefined;
};

export function createNixopusClient(requestContext?: NixopusRequestContext) {
  const token = requestContext?.get?.('authToken') || config.authToken;
  const cookies = requestContext?.get?.('cookies');
  const orgId = requestContext?.get?.('organizationId');
  const userId = requestContext?.get?.('userId');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cookies) {
    headers['Cookie'] = cookies;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    throw new AuthenticationError(
      'Authentication required. Provide an API key (Authorization header) or valid session (cookies).',
    );
  }
  if (orgId) {
    headers['X-Organization-Id'] = orgId;
  }
  if (userId) {
    headers['X-User-Id'] = userId as string;
  }

  return createClient({
    baseUrl: API_BASE_URL,
    headers,
  });
}
