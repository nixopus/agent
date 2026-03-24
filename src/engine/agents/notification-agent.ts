import { Agent } from '@mastra/core/agent';
import { config } from '../../config';
import { openrouterProvider, agentDefaults } from './shared';
import { notificationTools } from '../tools/api/notification-tools';
import {
  getNotificationPreferencesTool,
  updateNotificationPreferencesTool,
  getSmtpConfigTool,
  createSmtpConfigTool,
  updateSmtpConfigTool,
  deleteSmtpConfigTool,
  getWebhookNotificationTool,
  createWebhookNotificationTool,
  updateWebhookNotificationTool,
  deleteWebhookNotificationTool,
} from '../tools/api/notification-config-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const configTools = {
  getNotificationPreferences: getNotificationPreferencesTool,
  updateNotificationPreferences: updateNotificationPreferencesTool,
  getSmtpConfig: getSmtpConfigTool,
  createSmtpConfig: createSmtpConfigTool,
  updateSmtpConfig: updateSmtpConfigTool,
  deleteSmtpConfig: deleteSmtpConfigTool,
  getWebhookNotification: getWebhookNotificationTool,
  createWebhookNotification: createWebhookNotificationTool,
  updateWebhookNotification: updateWebhookNotificationTool,
  deleteWebhookNotification: deleteWebhookNotificationTool,
};
const notificationAgentTools = guardToolsForSchemaCompat({ ...notificationTools, ...configTools });

export const notificationAgent = new Agent({
  id: 'notification-agent',
  name: 'Notification Agent',
  description: 'Sends deployment notifications via Slack, Discord, or Email. Manages notification channel configuration.',
  instructions: `Nixopus notification assistant. Send notifications via Slack, Discord, Email. Manage channel settings. No emojis. Plain text only.

Send: check configured channels (get_webhook_notification for Slack/Discord, get_smtp_config for email) → send → report. No specific channel requested → send to all active. Channel not configured → offer setup.

Setup: Slack/Discord → create_webhook_notification(type, webhook URL). Email → create_smtp_config(host, port, user, pass).

On delegation: accept message + channel preference. If channel fails, try alternatives. Confirm what was sent and where. Use **bold** for outcomes.`,
  model: config.agentLightModel,
  tools: notificationAgentTools,
  defaultOptions: agentDefaults({
    maxSteps: 10,
    modelSettings: { maxOutputTokens: 2000 },
    providerOptions: openrouterProvider(2000),
  }),
});
