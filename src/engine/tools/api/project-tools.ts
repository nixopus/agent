import {
  createProject,
  deployProject,
  duplicateProject,
  listProjectsInFamily,
  listFamilyEnvironments,
  addProjectToFamily,
  generateRandomSubdomain,
  zCreateProjectData,
  zDeployProjectData,
  zDuplicateProjectData,
  zListProjectsInFamilyData,
  zListFamilyEnvironmentsData,
  zAddProjectToFamilyData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';
import { getClient, compactResult } from './shared';
import { createLogger } from '../../../logger';

const logger = createLogger('project-tools');

const tools = defineToolGroup({
  createProject: {
    id: 'create_project',
    description:
      'Create a new project. repository: GitHub repo ID as STRING (get_github_repositories). ' +
      'Pass port (single) or compose_services (multi) based on your analysis of the repo. ' +
      'When passing compose_services, build_pack is auto-set to "docker-compose" and dockerfile_path defaults to "docker-compose.yml". ' +
      'To use a custom compose file, set dockerfile_path (e.g. "docker-compose.prod.yml"). ' +
      'compose_domains (domain, service_name, port) for domain→service mapping at create time.',
    schema: zCreateProjectData,
    sdkFn: createProject,
    execute: async (inputData: any, ctx: any) => {
      const coerced = { ...(inputData as Record<string, unknown>) };
      if (coerced.repository != null) coerced.repository = String(coerced.repository);
      const body = coerced.body ?? coerced;
      const inner = (typeof body === 'object' && body !== null ? body : coerced) as Record<string, unknown>;
      if (Array.isArray(inner.compose_services) && inner.compose_services.length > 0) {
        if (!inner.build_pack) inner.build_pack = 'docker-compose';
        if (!inner.dockerfile_path || inner.dockerfile_path === 'Dockerfile') {
          inner.dockerfile_path = 'docker-compose.yml';
        }
      }
      if (!Array.isArray(inner.domains) || inner.domains.length === 0) {
        try {
          const subdomainResult = await generateRandomSubdomain({
            client: getClient(ctx),
          } as unknown as Parameters<typeof generateRandomSubdomain>[0]);
          const subdomain = (subdomainResult as any)?.data?.subdomain
            ?? (subdomainResult as any)?.data?.data?.subdomain;
          if (subdomain) {
            inner.domains = [subdomain];
          }
        } catch (err) {
          logger.warn({ err }, 'auto-subdomain generation failed, proceeding without domain');
        }
      }
      const result = await createProject({
        client: getClient(ctx),
        body: inner,
      } as unknown as Parameters<typeof createProject>[0]);
      return compactResult(result, 'create_project');
    },
  },
  deployProject: {
    id: 'deploy_project',
    description: 'Mutating. Deploy a project/application. Do not pass source again when already persisted.',
    schema: zDeployProjectData,
    sdkFn: deployProject,
    compact: true,
  },
  duplicateProject: {
    id: 'duplicate_project',
    description: 'Mutating. Duplicate an existing project into a new one.',
    schema: zDuplicateProjectData,
    sdkFn: duplicateProject,
  },
  getProjectFamily: {
    id: 'get_project_family',
    description: 'Read-only. Get project family details for a family/application identifier.',
    schema: zListProjectsInFamilyData,
    sdkFn: listProjectsInFamily,
    params: 'query' as const,
  },
  getEnvironmentsInFamily: {
    id: 'get_environments_in_family',
    description: 'Read-only. List environments in a project family.',
    schema: zListFamilyEnvironmentsData,
    sdkFn: listFamilyEnvironments,
    params: 'query' as const,
  },
  addProjectToFamily: {
    id: 'add_project_to_family',
    description: 'Mutating. Add a project/application to a family group.',
    schema: zAddProjectToFamilyData,
    sdkFn: addProjectToFamily,
  },
});

import { createTool } from '@mastra/core/tools';

export const quickDeployTool = createTool({
  id: 'quick_deploy',
  description:
    'Create and deploy a project in one step. Auto-generates a subdomain if domains is empty. ' +
    'Use for first-time deploys when analysis is complete and hints.confidence is "high". ' +
    'Same input as create_project. Returns app ID, deployment ID, and assigned domain.',
  inputSchema: zCreateProjectData,
  execute: async (inputData: any, ctx: any) => {
    const coerced = { ...(inputData as Record<string, unknown>) };
    if (coerced.repository != null) coerced.repository = String(coerced.repository);
    const body = coerced.body ?? coerced;
    const inner = (typeof body === 'object' && body !== null ? body : coerced) as Record<string, unknown>;

    if (Array.isArray(inner.compose_services) && inner.compose_services.length > 0) {
      if (!inner.build_pack) inner.build_pack = 'docker-compose';
      if (!inner.dockerfile_path || inner.dockerfile_path === 'Dockerfile') {
        inner.dockerfile_path = 'docker-compose.yml';
      }
    }

    let assignedDomain: string | null = null;
    if (!Array.isArray(inner.domains) || inner.domains.length === 0) {
      try {
        const subdomainResult = await generateRandomSubdomain({
          client: getClient(ctx),
        } as unknown as Parameters<typeof generateRandomSubdomain>[0]);
        const subdomain = (subdomainResult as any)?.data?.subdomain
          ?? (subdomainResult as any)?.data?.data?.subdomain;
        if (subdomain) {
          inner.domains = [subdomain];
          assignedDomain = subdomain;
        }
      } catch (err) {
        logger.warn({ err }, 'quick_deploy: subdomain generation failed');
      }
    } else {
      assignedDomain = (inner.domains as string[])[0] ?? null;
    }

    const createResult = await createProject({
      client: getClient(ctx),
      body: inner,
    } as unknown as Parameters<typeof createProject>[0]);

    const appData = (createResult as any)?.data?.data ?? (createResult as any)?.data ?? createResult;
    const applicationId = appData?.id;

    if (!applicationId) {
      return {
        error: 'Project creation failed',
        createResult: compactResult(createResult, 'quick_deploy'),
      };
    }

    const deployResult = await deployProject({
      client: getClient(ctx),
      body: { id: applicationId },
    } as unknown as Parameters<typeof deployProject>[0]);

    const deployData = (deployResult as any)?.data?.data ?? (deployResult as any)?.data ?? deployResult;
    const deploymentId = deployData?.id ?? deployData?.deployment_id;

    return {
      applicationId,
      applicationName: appData?.name ?? inner.name,
      deploymentId,
      domain: assignedDomain,
      status: deployData?.status ?? 'queued',
      message: 'Project created and deployment started. Poll getDeploymentById for status.',
    };
  },
});

export const createProjectTool = tools.createProject;
export const deployProjectTool = tools.deployProject;
export const duplicateProjectTool = tools.duplicateProject;
export const getProjectFamilyTool = tools.getProjectFamily;
export const getEnvironmentsInFamilyTool = tools.getEnvironmentsInFamily;
export const addProjectToFamilyTool = tools.addProjectToFamily;
export const projectTools = tools;
