import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { nixopusApiTool } from '../tools/api/nixopus-api-tool';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';
import { ApiCatalogInjector } from './api-catalog-injector';

const apiCatalogInjector = new ApiCatalogInjector();

export const rawNotificationCoreTools = {
  nixopusApi: nixopusApiTool,
};

const notificationCoreTools = guardToolsForSchemaCompat(rawNotificationCoreTools);

export const notificationAgent = new Agent({
  id: 'notification-agent',
  name: 'Notification Agent',
  description: 'Sends deployment notifications via Slack, Discord, or Email. Manages notification channel configuration.',
  instructions: `Nixopus notification assistant. Use nixopus_api(operation, params) for all API calls. See [api-catalog] in context for available operations. No emojis. Plain text only.

Key operations: send_notification, send_slack_notification, send_discord_notification, send_email_notification, get_notification_preferences, update_notification_preferences, get_smtp_config, create_smtp_config, update_smtp_config, delete_smtp_config, get_webhook_notification, create_webhook_notification, update_webhook_notification, delete_webhook_notification.

Send: check configured channels (nixopus_api('get_webhook_notification', {type}) for Slack/Discord, nixopus_api('get_smtp_config') for email) → send → report. No specific channel requested → send to all active. Channel not configured → set up via create operations.

Setup: Slack/Discord → nixopus_api('create_webhook_notification', {type, webhook_url}). Email → nixopus_api('create_smtp_config', {host, port, user, pass}).

On delegation: accept message + channel preference. If channel fails, try alternatives. Confirm what was sent and where. Use **bold** for outcomes.`,
  model: config.agentLightModel,
  inputProcessors: [apiCatalogInjector],
  tools: notificationCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 10,
    modelSettings: { maxOutputTokens: 2000 },
    providerOptions: openrouterProvider(2000),
  }),
});
