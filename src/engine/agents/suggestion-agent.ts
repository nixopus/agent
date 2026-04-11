import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { applicationTools } from '../tools/api/application-tools';
import { githubConnectorTools } from '../tools/api/github-connector-tools';
import { getDomainsTool } from '../tools/api/domain-tools';
import { getServersTool } from '../tools/api/system-tools';
import { listContainersTool } from '../tools/api/container-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const rawSuggestionTools = {
  getApplications: applicationTools.getApplications,
  getGithubRepositories: githubConnectorTools.getGithubRepositories,
  getServers: getServersTool,
  getDomains: getDomainsTool,
  listContainers: listContainersTool,
};

const suggestionTools = guardToolsForSchemaCompat(rawSuggestionTools);

const SUGGESTION_INSTRUCTIONS = `You are a suggestion engine for Nixopus, a deployment platform. Given a partial user input and optional thread context, return structured suggestions.

Your job:
1. Parse the partial input to understand user intent
2. If thread context is provided, use it to make suggestions more relevant
3. Fetch the user's entities (apps, repos, servers, domains, containers) via tools to suggest real resources
4. Return a JSON object with a "suggestions" array

Each suggestion has:
- id: unique string (s1, s2, etc.)
- type: "intent" (completing a thought), "entity" (a specific resource), or "action" (a concrete operation)
- label: short display text
- description: one-line context (e.g. "Next.js repo, last deployed 2h ago")
- fillText: the full text to insert into the chat input
- icon: one of "repo", "app", "server", "domain", "sparkles", "zap"
- confidence: 0 to 1

Rules:
- Return 3-7 suggestions, sorted by confidence descending
- Mix types: include at least one intent and one entity/action when possible
- For very short inputs (2-3 chars), bias toward broad capability discovery
- For longer inputs with clear intent, bias toward specific entities and actions
- Bias toward actionable suggestions that show what the platform can do
- Only suggest entities that actually exist in the user's account
- Do not fabricate resource names. Every entity must come from a tool call.
- Respond ONLY with the JSON object. No markdown, no explanation.

Output format:
{"suggestions": [{"id": "s1", "type": "action", "label": "...", "description": "...", "fillText": "...", "icon": "repo", "confidence": 0.95}, ...]}`;

export const suggestionAgent = new Agent({
  id: 'suggestion-agent',
  name: 'Suggestion Agent',
  description: 'Returns structured autocomplete suggestions for the chat input based on partial user input, thread context, and account entities.',
  instructions: SUGGESTION_INSTRUCTIONS,
  model: config.agentLightModel,
  tools: suggestionTools,
  defaultOptions: agentDefaults({
    maxSteps: 6,
    modelSettings: { maxOutputTokens: 1500 },
    providerOptions: openrouterProvider(1500, { noReasoning: true }),
  }),
}) as Agent<
  'suggestion-agent',
  typeof suggestionTools,
  undefined,
  unknown
> & { tools: typeof suggestionTools; instructions: string };

Object.assign(suggestionAgent, {
  tools: suggestionTools,
  instructions: SUGGESTION_INSTRUCTIONS,
});
