import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
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

export const rawNotificationCoreTools = {
  ...notificationTools,
  getNotificationPreferences: getNotificationPreferencesTool,
  getWebhookNotification: getWebhookNotificationTool,
  getSmtpConfig: getSmtpConfigTool,
};

export const rawNotificationSearchableTools = {
  updateNotificationPreferences: updateNotificationPreferencesTool,
  createSmtpConfig: createSmtpConfigTool,
  updateSmtpConfig: updateSmtpConfigTool,
  deleteSmtpConfig: deleteSmtpConfigTool,
  createWebhookNotification: createWebhookNotificationTool,
  updateWebhookNotification: updateWebhookNotificationTool,
  deleteWebhookNotification: deleteWebhookNotificationTool,
};

const notificationCoreTools = guardToolsForSchemaCompat(rawNotificationCoreTools);
const notificationSearchableTools = guardToolsForSchemaCompat(rawNotificationSearchableTools);

const notificationToolSearch = new ToolSearchProcessor({
  tools: notificationSearchableTools,
  search: { topK: 4, minScore: 0.1 },
});

export const notificationAgent = new Agent({
  id: 'notification-agent',
  name: 'Notification Agent',
  description: 'Sends deployment notifications via Slack, Discord, or Email. Manages notification channel configuration.',
  instructions: `Nixopus notification assistant. Send notifications via Slack, Discord, Email. Manage channel settings. No emojis. Plain text only.

## Tool Loading
Core tools are available immediately: send_notification, send_slack_notification, send_discord_notification, send_email_notification, get_notification_preferences, get_webhook_notification, get_smtp_config.
For channel setup and config mutations, use search_tools by keyword then load_tool to activate:
- Preferences: "update notification preferences"
- SMTP setup: "smtp create update delete"
- Webhook setup: "webhook create update delete"

Send: check configured channels (get_webhook_notification for Slack/Discord, get_smtp_config for email) → send → report. No specific channel requested → send to all active. Channel not configured → search_tools("webhook create") or search_tools("smtp create") → load_tool → set up.

Setup: Slack/Discord → search_tools("webhook create") → load_tool → create_webhook_notification(type, webhook URL). Email → search_tools("smtp create") → load_tool → create_smtp_config(host, port, user, pass).

On delegation: accept message + channel preference. If channel fails, try alternatives. Confirm what was sent and where. Use **bold** for outcomes.`,
  model: config.agentLightModel,
  inputProcessors: [notificationToolSearch],
  tools: notificationCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 10,
    modelSettings: { maxOutputTokens: 2000 },
    providerOptions: openrouterProvider(2000),
  }),
});
