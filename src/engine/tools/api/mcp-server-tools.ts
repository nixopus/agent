import {
  addMcpServer,
  deleteMcpServer,
  updateMcpServer,
  testMcpServerConnection,
  listMcpProviderCatalog,
  listOrgMcpServers,
  agentDiscoverToolsFromAllEnabledMcpServers,
  agentListEnabledServersWithCredentials,
  agentInvokeAToolOnAnMcpServer,
  zAddMcpServerData,
  zDeleteMcpServerData,
  zUpdateMcpServerData,
  zTestMcpServerConnectionData,
  zListMcpProviderCatalogData,
  zListOrgMcpServersData,
  zAgentDiscoverToolsFromAllEnabledMcpServersData,
  zAgentListEnabledServersWithCredentialsData,
  zAgentInvokeAToolOnAnMcpServerData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  listMcpProviderCatalog: {
    id: 'list_mcp_provider_catalog',
    description: 'Read-only. List available MCP server providers from the catalog. Shows provider names, descriptions, and configuration requirements.',
    schema: zListMcpProviderCatalogData,
    sdkFn: listMcpProviderCatalog,
    params: 'query' as const,
    compact: true,
  },
  listOrgMcpServers: {
    id: 'list_org_mcp_servers',
    description: 'Read-only. List MCP servers configured for the organization. Shows server IDs, names, status, and provider details.',
    schema: zListOrgMcpServersData,
    sdkFn: listOrgMcpServers,
    params: 'query' as const,
    compact: true,
  },
  addMcpServer: {
    id: 'add_mcp_server',
    description: 'Mutating. Add a new MCP server to the organization. Provide server name, provider, and configuration.',
    schema: zAddMcpServerData,
    sdkFn: addMcpServer,
  },
  updateMcpServer: {
    id: 'update_mcp_server',
    description: 'Mutating. Update an existing MCP server configuration.',
    schema: zUpdateMcpServerData,
    sdkFn: updateMcpServer,
  },
  deleteMcpServer: {
    id: 'delete_mcp_server',
    description: 'Destructive. Delete an MCP server from the organization. Requires server ID.',
    schema: zDeleteMcpServerData,
    sdkFn: deleteMcpServer,
    requireApproval: true,
  },
  testMcpServerConnection: {
    id: 'test_mcp_server_connection',
    description: 'Read-only. Test connectivity to an MCP server. Returns connection status and any errors.',
    schema: zTestMcpServerConnectionData,
    sdkFn: testMcpServerConnection,
  },
  discoverMcpTools: {
    id: 'discover_mcp_tools',
    description: 'Read-only. Discover tools from all enabled MCP servers. Returns server_id, tool names, descriptions, and inputSchema for each tool. Use the server_id and tool name with call_mcp_tool to invoke them.',
    schema: zAgentDiscoverToolsFromAllEnabledMcpServersData,
    sdkFn: agentDiscoverToolsFromAllEnabledMcpServers,
    params: 'query' as const,
  },
  listEnabledMcpServers: {
    id: 'list_enabled_mcp_servers',
    description: 'Read-only. List enabled MCP servers with their credentials and connection details.',
    schema: zAgentListEnabledServersWithCredentialsData,
    sdkFn: agentListEnabledServersWithCredentials,
    params: 'query' as const,
  },
  callMcpTool: {
    id: 'call_mcp_tool',
    description: 'Mutating. Execute a tool on an MCP server. First call discover_mcp_tools to get server_id and tool schemas. Pass: server_id (UUID), tool_name (exact name), arguments (JSON object with proper types matching the inputSchema — use strings, numbers, booleans as appropriate, NOT everything as strings). Returns tool output as content array.',
    schema: zAgentInvokeAToolOnAnMcpServerData,
    sdkFn: agentInvokeAToolOnAnMcpServer,
  },
});

export const listMcpProviderCatalogTool = tools.listMcpProviderCatalog;
export const listOrgMcpServersTool = tools.listOrgMcpServers;
export const addMcpServerTool = tools.addMcpServer;
export const updateMcpServerTool = tools.updateMcpServer;
export const deleteMcpServerTool = tools.deleteMcpServer;
export const testMcpServerConnectionTool = tools.testMcpServerConnection;
export const discoverMcpToolsTool = tools.discoverMcpTools;
export const listEnabledMcpServersTool = tools.listEnabledMcpServers;
export const callMcpToolTool = tools.callMcpTool;
export const mcpServerTools = tools;
