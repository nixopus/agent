import {
  listApplications,
  getApplication,
  listApplicationDeployments,
  getDeployment,
  getDeploymentLogs,
  getApplicationLogs,
  deployApplication,
  restartDeployment,
  rollbackDeployment,
  redeployApplication,
  deleteApplication,
  updateApplication,
  updateApplicationLabels,
  addApplicationDomain,
  removeApplicationDomain,
  previewComposeServices,
  recoverApplication,
  listComposeServices,
  zListApplicationsData,
  zGetApplicationData,
  zListApplicationDeploymentsData,
  zGetDeploymentData,
  zGetDeploymentLogsData,
  zGetApplicationLogsData,
  zDeployApplicationData,
  zRestartDeploymentData,
  zRollbackDeploymentData,
  zRedeployApplicationData,
  zDeleteApplicationData,
  zUpdateApplicationData,
  zUpdateApplicationLabelsData,
  zAddApplicationDomainData,
  zRemoveApplicationDomainData,
  zPreviewComposeServicesData,
  zRecoverApplicationData,
  zListComposeServicesData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  getApplications: {
    id: 'get_applications',
    description: '[READ] List all applications. Call this first to discover app IDs. Optional query: page, page_size, sort_by, sort_direction ("asc"|"desc"). Compact by default; pass verbose: true for full objects.',
    schema: zListApplicationsData,
    sdkFn: listApplications,
    params: 'query' as const,
    compact: true,
  },
  getApplication: {
    id: 'get_application',
    description: '[READ] Get one application. Required: query.id (app UUID). Returns full config: name, status, port, domains, env vars, build_pack.',
    schema: zGetApplicationData,
    sdkFn: getApplication,
    params: 'query' as const,
    compact: true,
  },
  getApplicationDeployments: {
    id: 'get_application_deployments',
    description: '[READ] List deployments for an app. Required: query.id (app UUID). Optional: query.page, query.limit. Use this to find deployment UUIDs for get_deployment_by_id, get_deployment_logs, restart_deployment, rollback_deployment.',
    schema: zListApplicationDeploymentsData,
    sdkFn: listApplicationDeployments,
    params: 'query' as const,
    compact: true,
  },
  getDeploymentById: {
    id: 'get_deployment_by_id',
    description: '[READ] Get one deployment. Required: path.deployment_id (deployment UUID — NOT app ID). Find deployment IDs via get_application_deployments.',
    schema: zGetDeploymentData,
    sdkFn: getDeployment,
    params: 'path' as const,
    compact: true,
  },
  getDeploymentLogs: {
    id: 'get_deployment_logs',
    description: '[READ] Get logs for one deployment. Required: deployment_id (deployment UUID). Optional: page, page_size, level, start_time, end_time (ISO 8601), search_term, verbose (true to skip truncation). For logs across all deployments → get_application_logs.',
    schema: zGetDeploymentLogsData,
    sdkFn: getDeploymentLogs,
    logs: { pathKey: 'deployment_id' },
  },
  getApplicationLogs: {
    id: 'get_application_logs',
    description: '[READ] Get runtime logs across all deployments for an app. Required: application_id (app UUID — NOT deployment_id). Optional: page, page_size, level, start_time, end_time (ISO 8601), search_term, verbose (true to skip truncation). For one deployment only → get_deployment_logs.',
    schema: zGetApplicationLogsData,
    sdkFn: getApplicationLogs,
    logs: { pathKey: 'application_id' },
  },
  createApplication: {
    id: 'create_application',
    description: '[MUTATING] Create and deploy a new application. All params in body. IMPORTANT: body.repository must be a STRING (e.g. "968057391"), never a bare number — find it via get_github_repositories. body.source: "github" (default), "s3" (workspace files), "zip", "staging". Optional: name, branch, port, build_pack, dockerfile_path, base_path (monorepo subdir), environment_variables, build_variables, pre_run_command, post_run_command, domains, compose_domains [{domain, service_name, port}].',
    schema: zDeployApplicationData,
    sdkFn: deployApplication,
    requireApproval: true,
    transform: (input) => {
      if (input.repository != null) input.repository = String(input.repository);
      return input;
    },
  },
  deleteApplication: {
    id: 'delete_application',
    description: '[DESTRUCTIVE] Permanently delete an application and all its deployments. Cannot be undone. Required: body.id (app UUID). Verify with get_application first.',
    schema: zDeleteApplicationData,
    sdkFn: deleteApplication,
  },
  updateApplication: {
    id: 'update_application',
    description: '[MUTATING] Update app config. Does NOT redeploy — call redeploy_application after if needed. Required: body.id (app UUID). Only include fields to change: name, port, environment_variables, build_variables, build_pack, dockerfile_path, base_path, domains, pre_run_command, post_run_command, environment, compose_domains [{domain, service_name, port}], force.',
    schema: zUpdateApplicationData,
    sdkFn: updateApplication,
  },
  updateApplicationLabels: {
    id: 'update_application_labels',
    description: '[MUTATING] Replace all labels on an app (overwrites, not append). Required: id (app UUID), labels (string[] — full desired list).',
    schema: zUpdateApplicationLabelsData,
    sdkFn: updateApplicationLabels,
    queryKeys: ['id'],
  },
  addApplicationDomain: {
    id: 'add_application_domain',
    description: '[MUTATING] Attach a domain to an app. Required: id (app UUID), domain (string). For Compose apps: also pass service_name to route to a specific service, optionally port to override.',
    schema: zAddApplicationDomainData,
    sdkFn: addApplicationDomain,
    queryKeys: ['id'],
  },
  removeApplicationDomain: {
    id: 'remove_application_domain',
    description: '[MUTATING] Remove a domain from an app. Required: id (app UUID), domain (exact domain string to remove). Check current domains via get_application.',
    schema: zRemoveApplicationDomainData,
    sdkFn: removeApplicationDomain,
    queryKeys: ['id'],
  },
  restartDeployment: {
    id: 'restart_deployment',
    description: '[MUTATING] Restart a deployment in-place (no rebuild). Required: body.id (deployment UUID — NOT app ID). Find via get_application_deployments. For fresh build → redeploy_application.',
    schema: zRestartDeploymentData,
    sdkFn: restartDeployment,
    requireApproval: true,
  },
  rollbackDeployment: {
    id: 'rollback_deployment',
    description: '[MUTATING] Roll back to a previous deployment. Required: body.id (deployment UUID of the TARGET older deployment, not the current one). List past deployments via get_application_deployments.',
    schema: zRollbackDeploymentData,
    sdkFn: rollbackDeployment,
    requireApproval: true,
  },
  redeployApplication: {
    id: 'redeploy_application',
    description: '[MUTATING] Rebuild and deploy from source. Do NOT pass source/repository/branch (already configured). Required: body.id (app UUID — NOT deployment_id). Optional: body.force (deploy even if unchanged), body.force_without_cache (ignore Docker cache). To restart without rebuild → restart_deployment.',
    schema: zRedeployApplicationData,
    sdkFn: redeployApplication,
  },
  previewCompose: {
    id: 'preview_compose',
    description: '[READ] Preview Compose services from a repo without deploying. Returns service names and ports. All params in body: repository (string repo ID), branch, dockerfile_path, base_path. Use before create_application for Compose apps.',
    schema: zPreviewComposeServicesData,
    sdkFn: previewComposeServices,
  },
  recoverApplication: {
    id: 'recover_application',
    description: '[MUTATING] Recover a failed/stuck app when redeploy does not work. Required: body.application_id (app UUID). NOTE: param is body.application_id, NOT body.id.',
    schema: zRecoverApplicationData,
    sdkFn: recoverApplication,
    requireApproval: true,
  },
  getComposeServices: {
    id: 'get_compose_services',
    description: '[READ] List running Compose services for a deployed app. Required: query.id (app UUID). Only for Compose apps, not single-container. Pre-deploy preview → preview_compose.',
    schema: zListComposeServicesData,
    sdkFn: listComposeServices,
    params: 'query' as const,
  },
});

export const getApplicationsTool = tools.getApplications;
export const getApplicationTool = tools.getApplication;
export const getApplicationDeploymentsTool = tools.getApplicationDeployments;
export const getDeploymentByIdTool = tools.getDeploymentById;
export const getDeploymentLogsTool = tools.getDeploymentLogs;
export const getApplicationLogsTool = tools.getApplicationLogs;
export const createApplicationTool = tools.createApplication;
export const deleteApplicationTool = tools.deleteApplication;
export const updateApplicationTool = tools.updateApplication;
export const updateApplicationLabelsTool = tools.updateApplicationLabels;
export const addApplicationDomainTool = tools.addApplicationDomain;
export const removeApplicationDomainTool = tools.removeApplicationDomain;
export const restartDeploymentTool = tools.restartDeployment;
export const rollbackDeploymentTool = tools.rollbackDeployment;
export const redeployApplicationTool = tools.redeployApplication;
export const previewComposeTool = tools.previewCompose;
export const recoverApplicationTool = tools.recoverApplication;
export const getComposeServicesTool = tools.getComposeServices;
export const applicationTools = tools;
