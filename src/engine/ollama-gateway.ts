import { MastraModelGateway } from '@mastra/core/llm';
import type { ProviderConfig, GatewayLanguageModel } from '@mastra/core/llm';
import { createOllama } from 'ollama-ai-provider-v2';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/api';

/**
 * Gateway for local Ollama instances.
 * Resolves model strings like "ollama/llama3.2" using the ollama-ai-provider-v2 SDK,
 * pointing at OLLAMA_BASE_URL (defaults to localhost:11434).
 */
export class OllamaLocalGateway extends MastraModelGateway {
  readonly id = 'ollama';
  readonly name = 'Ollama (local)';

  private provider = createOllama({
    baseURL: process.env.OLLAMA_BASE_URL
      ? `${process.env.OLLAMA_BASE_URL.replace(/\/$/, '')}/api`
      : DEFAULT_BASE_URL,
  });

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      ollama: {
        url: process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL,
        apiKeyEnvVar: '',
        name: 'Ollama (local)',
        models: [],
        gateway: 'ollama',
      },
    };
  }

  buildUrl(): string | undefined {
    return process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    return 'ollama';
  }

  resolveLanguageModel({ modelId }: {
    modelId: string;
    providerId: string;
    apiKey: string;
    headers?: Record<string, string>;
  }): GatewayLanguageModel {
    return this.provider.chat(modelId) as unknown as GatewayLanguageModel;
  }
}
