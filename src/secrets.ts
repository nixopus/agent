import { createLogger } from './logger';
import { ConfigError, NotFoundError, ExternalServiceError } from './errors';

const logger = createLogger('secrets');

export type SecretManagerType = 'none' | 'infisical';

export interface SecretManagerConfig {
  type: SecretManagerType;
  enabled: boolean;
  projectId?: string;
  environment: string;
  secretPath?: string;
  serviceName: string;
  infisicalUrl?: string;
  infisicalToken?: string;
}

export interface SecretManager {
  getSecret(key: string): Promise<string>;
  getSecrets(prefix?: string): Promise<Record<string, string>>;
}

export function loadSecretManagerConfig(serviceName: string): SecretManagerConfig {
  const managerType = (process.env.SECRET_MANAGER_TYPE?.toLowerCase() || 'none') as SecretManagerType;
  const enabled = process.env.SECRET_MANAGER_ENABLED === 'true';

  if (!enabled && managerType === 'none') {
    return {
      type: 'none',
      enabled: false,
      environment: 'prod',
      serviceName,
    };
  }

  return {
    type: managerType,
    enabled,
    projectId: process.env.SECRET_MANAGER_PROJECT_ID,
    environment: process.env.SECRET_MANAGER_ENVIRONMENT || 'prod',
    secretPath: process.env.SECRET_MANAGER_SECRET_PATH || '/',
    serviceName,
    infisicalUrl: process.env.INFISICAL_URL || 'https://app.infisical.com',
    infisicalToken: process.env.INFISICAL_TOKEN,
  };
}

export async function createSecretManager(
  config: SecretManagerConfig
): Promise<SecretManager> {
  if (!config.enabled || config.type === 'none') {
    return new NoOpSecretManager();
  }

  switch (config.type) {
    case 'infisical':
      if (!config.infisicalToken) {
        throw new ConfigError('INFISICAL_TOKEN is required when using Infisical');
      }
      return new InfisicalManager(config);
    default:
      return new NoOpSecretManager();
  }
}

class NoOpSecretManager implements SecretManager {
  async getSecret(key: string): Promise<string> {
    throw new ConfigError('Secret manager not configured');
  }

  async getSecrets(prefix?: string): Promise<Record<string, string>> {
    return {};
  }
}

class InfisicalManager implements SecretManager {
  private config: SecretManagerConfig;
  private baseUrl: string;

  constructor(config: SecretManagerConfig) {
    this.config = config;
    this.baseUrl = config.infisicalUrl || 'https://app.infisical.com';
  }

  async getSecret(key: string): Promise<string> {
    const secrets = await this.getSecrets();
    const value = secrets[key];
    if (!value) {
      throw new NotFoundError('secret', key);
    }
    return value;
  }

  async getSecrets(prefix?: string): Promise<Record<string, string>> {
    const url = new URL(`${this.baseUrl}/api/v3/secrets/raw`);

    if (this.config.projectId) {
      url.searchParams.append('workspaceId', this.config.projectId);
    }
    if (!this.config.environment) {
      throw new ConfigError('Environment is required but not set in SECRET_MANAGER_ENVIRONMENT');
    }

    const envSlug = normalizeEnvironmentName(this.config.environment);
    url.searchParams.append('environment', envSlug);

    const secretPath = this.config.secretPath || '/';
    url.searchParams.append('secretPath', secretPath);

    url.searchParams.append('recursive', 'true');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.infisicalToken}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404) {
        logger.warn(
          { secretPath, environment: envSlug },
          'No secrets found. This is normal if secrets have not been created yet.',
        );
        return {};
      }
      throw new ExternalServiceError(
        'infisical',
        `Failed to fetch secrets from Infisical: ${response.status} ${body}`,
      );
    }

    const data = await response.json();
    const secrets: Record<string, string> = {};

    if (data.secrets && Array.isArray(data.secrets)) {
      for (const secret of data.secrets) {
        const key = secret.secretKey || secret.key;
        const value = secret.secretValue || secret.value;
        if (key && (!prefix || key.startsWith(prefix))) {
          secrets[key] = value;
        }
      }
    }
    else if (typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data)) {
        if (key === 'secrets' || key === 'imports') continue;
        if (!prefix || key.startsWith(prefix)) {
          secrets[key] = String(value);
        }
      }
    }

    return secrets;
  }
}

function normalizeEnvironmentName(env: string): string {
  const normalized = env.toLowerCase().trim();
  switch (normalized) {
    case 'dev':
    case 'development':
      return 'dev';
    case 'staging':
    case 'stage':
      return 'staging';
    case 'prod':
    case 'production':
      return 'prod';
    default:
      return normalized;
  }
}

export async function loadSecretsIntoEnv(
  manager: SecretManager,
  prefixes: string[] = []
): Promise<void> {
  if (!manager) {
    return;
  }

  try {
    for (const prefix of prefixes) {
      const secrets = await manager.getSecrets(prefix);
      for (const [key, value] of Object.entries(secrets)) {
        process.env[key] = value;
      }
    }

    const allSecrets = await manager.getSecrets();
    for (const [key, value] of Object.entries(allSecrets)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to load secrets');
    throw error;
  }
}
