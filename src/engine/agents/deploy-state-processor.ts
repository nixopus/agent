import type { Processor, ProcessInputStepArgs, ProcessInputStepResult } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';

const TOOL_TO_PHASE: Record<string, string> = {
  resolve_context: 'context_resolved',
  resolveContext: 'context_resolved',
  get_github_connectors: 'connectors_fetched',
  getGithubConnectors: 'connectors_fetched',
  analyze_repository: 'repo_analyzed',
  analyzeRepository: 'repo_analyzed',
  create_project: 'project_created',
  createProject: 'project_created',
  prepare_codebase: 'codebase_prepared',
  prepareCodebase: 'codebase_prepared',
  update_application: 'app_updated',
  updateApplication: 'app_updated',
  deploy_project: 'deploy_started',
  deployProject: 'deploy_started',
  get_application_deployments: 'status_checked',
  getApplicationDeployments: 'status_checked',
  get_deployment_logs: 'logs_checked',
  getDeploymentLogs: 'logs_checked',
};

interface DeployState {
  applicationId: string | null;
  applicationName: string | null;
  deploymentId: string | null;
  status: string | null;
  phase: string | null;
  completedSteps: string[];
}

function extractState(messages: MastraDBMessage[]): DeployState {
  const state: DeployState = {
    applicationId: null,
    applicationName: null,
    deploymentId: null,
    status: null,
    phase: null,
    completedSteps: [],
  };

  const seenPhases = new Set<string>();

  for (const msg of messages) {
    const content = msg?.content as Record<string, unknown> | undefined;
    if (!content) continue;

    const parts = content.parts as unknown[] | undefined;
    if (!parts || !Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;

      if (p.type === 'tool-invocation' || p.type === 'tool-result') {
        const toolName = p.toolName as string | undefined;
        if (toolName && TOOL_TO_PHASE[toolName]) {
          const phase = TOOL_TO_PHASE[toolName];
          if (!seenPhases.has(phase)) {
            seenPhases.add(phase);
            state.completedSteps.push(phase);
          }
          state.phase = phase;
        }

        const outputStr = p.output !== undefined
          ? (typeof p.output === 'string' ? p.output : JSON.stringify(p.output))
          : '';
        const inputStr = p.input !== undefined
          ? (typeof p.input === 'string' ? p.input : JSON.stringify(p.input))
          : '';
        const combined = `${outputStr} ${inputStr}`;

        const appIdMatch = combined.match(/"(?:application_id|applicationId|id)":\s*"([0-9a-f-]{36})"/i);
        if (appIdMatch) state.applicationId = appIdMatch[1];

        const appNameMatch = combined.match(/"(?:name|application_name)":\s*"([^"]+)"/);
        if (appNameMatch) state.applicationName = appNameMatch[1];

        const deployIdMatch = combined.match(/"(?:deployment_id|deploymentId)":\s*"([0-9a-f-]{36})"/i);
        if (deployIdMatch) state.deploymentId = deployIdMatch[1];

        const statusMatch = combined.match(/"status":\s*"([^"]+)"/);
        if (statusMatch) state.status = statusMatch[1];
      }
    }
  }

  return state;
}

function formatState(state: DeployState): string {
  const parts: string[] = ['[deploy-state]'];
  if (state.applicationId) parts.push(`applicationId=${state.applicationId}`);
  if (state.applicationName) parts.push(`name=${state.applicationName}`);
  if (state.deploymentId) parts.push(`deploymentId=${state.deploymentId}`);
  if (state.status) parts.push(`status=${state.status}`);
  if (state.completedSteps.length > 0) parts.push(`completed=${state.completedSteps.join(',')}`);
  if (state.phase) parts.push(`current_phase=${state.phase}`);
  parts.push('[/deploy-state]');
  return parts.join(' ');
}

const CONTEXT_RE = /\[context:\s*([^\]]+)\]/i;

interface WorkspaceContext {
  source?: string;
  applicationId?: string;
  workspaceId?: string;
  syncTarget?: string;
  branch?: string;
}

function parseWorkspaceContext(messages: MastraDBMessage[]): WorkspaceContext {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;

    const text = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');

    const match = text.match(CONTEXT_RE);
    if (!match) continue;

    const block = match[1];
    // Stop at comma/whitespace/] so comma-delimited blocks parse the same as space/newline-separated.
    const sourceMatch = block.match(/source=\s*([^,\s\]]+)/i);
    const appIdMatch = block.match(/applicationId=([0-9a-f-]{36})/i);
    const wsIdMatch = block.match(/workspaceId=([0-9a-f-]{36})/i);
    const syncTargetMatch = block.match(/syncTarget=([0-9a-f-]{36})/i);
    const branchMatch = block.match(/branch=\s*([^,\s\]]+)/i);

    return {
      source: sourceMatch?.[1],
      applicationId: appIdMatch?.[1],
      workspaceId: wsIdMatch?.[1],
      syncTarget: syncTargetMatch?.[1],
      branch: branchMatch?.[1],
    };
  }
  return {};
}

export class DeployStateProcessor implements Processor<'deploy-state'> {
  readonly id = 'deploy-state' as const;
  readonly name = 'Deploy State Tracker';

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    const state = extractState(args.messages);
    const stateText = (state.applicationId || state.completedSteps.length > 0)
      ? formatState(state)
      : '[deploy-state] no_active_deploy [/deploy-state]';

    const ctx = parseWorkspaceContext(args.messages);
    if (ctx.source) {
      args.requestContext?.set?.('workspaceSource', ctx.source);
    }
    if (ctx.applicationId) {
      args.requestContext?.set?.('contextApplicationId', ctx.applicationId);
    }
    if (ctx.workspaceId) {
      args.requestContext?.set?.('workspaceId', ctx.workspaceId);
    }
    if (ctx.syncTarget) {
      args.requestContext?.set?.('syncTarget', ctx.syncTarget);
    }
    if (ctx.branch) {
      args.requestContext?.set?.('contextBranch', ctx.branch);
    }

    return {
      systemMessages: [
        ...(args.systemMessages ?? []),
        {
          role: 'system' as const,
          content: stateText,
        },
      ],
    };
  }
}
