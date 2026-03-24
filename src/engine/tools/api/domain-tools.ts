import {
  addCustomDomain,
  verifyCustomDomain,
  removeCustomDomain,
  generateRandomSubdomain,
  listDomains,
  zAddCustomDomainData,
  zVerifyCustomDomainData,
  zRemoveCustomDomainData,
  zGenerateRandomSubdomainData,
  zListDomainsData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  createDomain: {
    id: 'create_domain',
    description: '[MUTATING] Register a custom domain. Required: body.name (domain string, e.g. "app.example.com"). Returns DNS setup instructions (record_type, name, value) — relay these to the user. After DNS is configured, call update_domain to verify.',
    schema: zAddCustomDomainData,
    sdkFn: addCustomDomain,
  },
  updateDomain: {
    id: 'update_domain',
    description: '[MUTATING] Verify DNS for a registered domain. Required: body.id (domain UUID — NOT the domain name string). Call this after the user has configured DNS records from create_domain. Find domain IDs via get_domains.',
    schema: zVerifyCustomDomainData,
    sdkFn: verifyCustomDomain,
  },
  deleteDomain: {
    id: 'delete_domain',
    description: '[DESTRUCTIVE] Remove a custom domain. Required: body.id (domain UUID). Find via get_domains.',
    schema: zRemoveCustomDomainData,
    sdkFn: removeCustomDomain,
  },
  generateRandomSubdomain: {
    id: 'generate_random_subdomain',
    description: '[READ] Generate a random available subdomain. No params required. Use before create_domain if the user needs a subdomain suggestion.',
    schema: zGenerateRandomSubdomainData,
    sdkFn: generateRandomSubdomain,
    params: 'spread' as const,
  },
  getDomains: {
    id: 'get_domains',
    description: '[READ] List all registered domains. Optional: query.type (filter by domain type). Returns id, name, status, dns_provider, verification_token per domain.',
    schema: zListDomainsData,
    sdkFn: listDomains,
    params: 'query' as const,
    compact: true,
  },
});

export const createDomainTool = tools.createDomain;
export const updateDomainTool = tools.updateDomain;
export const deleteDomainTool = tools.deleteDomain;
export const generateRandomSubdomainTool = tools.generateRandomSubdomain;
export const getDomainsTool = tools.getDomains;
export const domainTools = tools;
