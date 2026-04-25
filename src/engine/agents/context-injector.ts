import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import {
  listApplications,
  listDomains,
  listMachines,
  listGitHubConnectors,
  listGitHubRepositories,
  listOrgMcpServers,
} from '@nixopus/api-client';
import { createNixopusClient, type NixopusRequestContext } from '../tools/shared/nixopus-client';
import { createLogger } from '../../logger';

const logger = createLogger('context-injector');

const CTX_KEY = '__injectedContext';
const MAX_ENTRIES = 100;

interface AppEntry { name: string; id: string; status: string; port: number | string; branch: string; domains: string[] }
interface DomainEntry { domain: string; id: string; appName: string }
interface ConnectorEntry { name: string; id: string }
interface RepoEntry { name: string; id: string | number }
interface ServerEntry { name: string; id: string; ip: string; status: string; isDefault: boolean }
interface McpServerEntry { name: string; id: string; provider: string; status: string }

interface InjectedData {
  apps: AppEntry[];
  domains: DomainEntry[];
  servers: ServerEntry[];
  connectors: ConnectorEntry[];
  repos: RepoEntry[];
  mcpServers: McpServerEntry[];
}

function extractList(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  const obj = result as Record<string, unknown>;
  for (const key of ['data', 'items', 'results', 'applications', 'domains', 'repositories', 'servers']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

function val<T>(v: unknown, fb: T): T {
  return (v as T) ?? fb;
}

function compactApps(raw: unknown[]): AppEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const a = item as Record<string, unknown>;
    const domainList = Array.isArray(a.domains)
      ? (a.domains as Array<Record<string, unknown>>).map((d) => String(d.domain ?? d.name ?? d)).filter(Boolean)
      : [];
    return { name: val(a.name, ''), id: val(a.id, ''), status: val(a.status, 'unknown'), port: val(a.port, ''), branch: val(a.branch, 'main'), domains: domainList };
  }).filter((a) => a.id);
}

function compactDomains(raw: unknown[]): DomainEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const d = item as Record<string, unknown>;
    const app = d.application as Record<string, unknown> | undefined;
    return { domain: val(d.domain, val(d.name, '')), id: val(d.id, ''), appName: val(app?.name, '') };
  }).filter((d) => d.id);
}

function compactServers(raw: unknown[]): ServerEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const s = item as Record<string, unknown>;
    return {
      name: val(s.name, val(s.hostname, '')),
      id: val(s.id, ''),
      ip: val(s.ip, val(s.host, '')),
      status: val(s.status, 'unknown'),
      isDefault: !!s.is_default,
    };
  }).filter((s) => s.id);
}

function compactConnectors(raw: unknown[]): ConnectorEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const c = item as Record<string, unknown>;
    return { name: val(c.name, ''), id: val(c.id, '') };
  }).filter((c) => c.id);
}

function compactRepos(raw: unknown[]): RepoEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const r = item as Record<string, unknown>;
    return { name: val(r.name, val(r.full_name, '')), id: val(r.id, '') };
  }).filter((r) => r.id);
}

function compactMcpServers(raw: unknown[]): McpServerEntry[] {
  return raw.slice(0, MAX_ENTRIES).map((item) => {
    const s = item as Record<string, unknown>;
    return { name: val(s.name, ''), id: val(s.id, ''), provider: val(s.provider, ''), status: val(s.status, 'unknown') };
  }).filter((s) => s.id);
}

function overflowNote(total: number, shown: number): string {
  return total > shown ? ` (+${total - shown} more)` : '';
}

export function formatContext(data: InjectedData): string {
  const sections: string[] = [];

  if (data.apps.length > 0) {
    const items = data.apps.map(
      (a) => `${a.name}(id:${a.id},status:${a.status},port:${a.port},branch:${a.branch}${a.domains.length ? `,domains:${a.domains.join(',')}` : ''})`,
    );
    sections.push(`apps: ${items.join(' | ')}${overflowNote(data.apps.length, items.length)}`);
  }

  if (data.domains.length > 0) {
    const items = data.domains.map((d) => `${d.domain}(id:${d.id}${d.appName ? `,app:${d.appName}` : ''})`);
    sections.push(`domains: ${items.join(' | ')}${overflowNote(data.domains.length, items.length)}`);
  }

  if (data.servers.length > 0) {
    const items = data.servers.map(
      (s) => `${s.name}(id:${s.id},ip:${s.ip},status:${s.status}${s.isDefault ? ',default:true' : ''})`,
    );
    sections.push(`servers: ${items.join(' | ')}`);
  }

  if (data.connectors.length > 0) {
    const items = data.connectors.map((c) => `${c.name}(id:${c.id})`);
    sections.push(`connectors: ${items.join(' | ')}`);
  }

  if (data.repos.length > 0) {
    const items = data.repos.map((r) => `${r.name}(id:${r.id})`);
    sections.push(`repos: ${items.join(' | ')}${overflowNote(data.repos.length, items.length)}`);
  }

  if (data.mcpServers.length > 0) {
    const items = data.mcpServers.map((s) => `${s.name}(id:${s.id},provider:${s.provider},status:${s.status})`);
    sections.push(`mcp_servers: ${items.join(' | ')}`);
  }

  if (sections.length === 0) return '';
  return `[user-context]\n${sections.join('\n')}\n[/user-context]`;
}

async function fetchAndFormat(requestContext: NixopusRequestContext): Promise<string> {
  const client = createNixopusClient(requestContext) as unknown;
  const data: InjectedData = { apps: [], domains: [], servers: [], connectors: [], repos: [], mcpServers: [] };

  const results = await Promise.allSettled([
    listApplications({ client } as Parameters<typeof listApplications>[0]),
    listDomains({ client } as Parameters<typeof listDomains>[0]),
    listMachines({ client } as unknown as Parameters<typeof listMachines>[0]),
    listGitHubConnectors({ client } as Parameters<typeof listGitHubConnectors>[0]),
    listOrgMcpServers({ client } as Parameters<typeof listOrgMcpServers>[0]),
  ]);

  if (results[0].status === 'fulfilled') data.apps = compactApps(extractList(results[0].value));
  else logger.warn({ err: results[0].reason }, 'failed to fetch applications');

  if (results[1].status === 'fulfilled') data.domains = compactDomains(extractList(results[1].value));
  else logger.warn({ err: results[1].reason }, 'failed to fetch domains');

  if (results[2].status === 'fulfilled') data.servers = compactServers(extractList(results[2].value));
  else logger.warn({ err: results[2].reason }, 'failed to fetch servers');

  if (results[3].status === 'fulfilled') data.connectors = compactConnectors(extractList(results[3].value));
  else logger.warn({ err: results[3].reason }, 'failed to fetch connectors');

  if (results[4].status === 'fulfilled') data.mcpServers = compactMcpServers(extractList(results[4].value));
  else logger.warn({ err: results[4].reason }, 'failed to fetch MCP servers');

  if (data.connectors.length > 0) {
    const repoResults = await Promise.allSettled(
      data.connectors.map((c) =>
        listGitHubRepositories({ client, query: { connector_id: c.id } } as unknown as Parameters<typeof listGitHubRepositories>[0]),
      ),
    );
    for (const r of repoResults) {
      if (r.status === 'fulfilled') data.repos.push(...compactRepos(extractList(r.value)));
    }
    if (data.repos.length > MAX_ENTRIES) data.repos = data.repos.slice(0, MAX_ENTRIES);
  }

  return formatContext(data);
}

type ReqCtx = { get?: (k: string) => unknown; set?: (k: string, v: unknown) => void };

export class ContextInjectorProcessor implements Processor<'context-injector'> {
  readonly id = 'context-injector' as const;
  readonly name = 'Context Injector';

  async processInputStep(args: ProcessInputStepArgs): Promise<ProcessInputStepResult> {
    const rc = args.requestContext as ReqCtx | undefined;
    let contextText = rc?.get?.(CTX_KEY) as string | undefined;

    if (!contextText && args.stepNumber === 0) {
      const reqCtx = rc as NixopusRequestContext | undefined;
      if (reqCtx?.get?.('authToken') || reqCtx?.get?.('cookies')) {
        try {
          contextText = await fetchAndFormat(reqCtx);
          if (contextText) rc?.set?.(CTX_KEY, contextText);
        } catch (err) {
          logger.warn({ err }, 'context-injector: fetch failed, skipping injection');
        }
      }
    }

    if (!contextText) return {};

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        { role: 'system' as const, content: contextText },
      ],
    };
  }
}
