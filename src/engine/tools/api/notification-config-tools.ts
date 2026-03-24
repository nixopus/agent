import {
  getNotificationPreferences,
  getSmtpConfig,
  getWebhookConfig,
  deleteSmtpConfig,
  deleteWebhookConfig,
  updateNotificationPreferences,
  createSmtpConfig,
  createWebhookConfig,
  updateSmtpConfig,
  updateWebhookConfig,
  zGetNotificationPreferencesData,
  zGetSmtpConfigData,
  zGetWebhookConfigData,
  zDeleteSmtpConfigData,
  zDeleteWebhookConfigData,
  zUpdateNotificationPreferencesData,
  zCreateSmtpConfigData,
  zCreateWebhookConfigData,
  zUpdateSmtpConfigData,
  zUpdateWebhookConfigData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  getNotificationPreferences: {
    id: 'get_notification_preferences',
    description: 'Read-only. Get current notification preferences.',
    schema: zGetNotificationPreferencesData,
    sdkFn: getNotificationPreferences,
    params: 'query' as const,
  },
  updateNotificationPreferences: {
    id: 'update_notification_preferences',
    description: 'Mutating. Update notification preferences.',
    schema: zUpdateNotificationPreferencesData,
    sdkFn: updateNotificationPreferences,
  },
  getSmtpConfig: {
    id: 'get_smtp_config',
    description: 'Read-only. Get SMTP notification configuration.',
    schema: zGetSmtpConfigData,
    sdkFn: getSmtpConfig,
    params: 'query' as const,
  },
  createSmtpConfig: {
    id: 'create_smtp_config',
    description: 'Mutating. Create SMTP notification configuration.',
    schema: zCreateSmtpConfigData,
    sdkFn: createSmtpConfig,
  },
  updateSmtpConfig: {
    id: 'update_smtp_config',
    description: 'Mutating. Update SMTP notification configuration.',
    schema: zUpdateSmtpConfigData,
    sdkFn: updateSmtpConfig,
  },
  deleteSmtpConfig: {
    id: 'delete_smtp_config',
    description: 'Mutating and destructive. Delete SMTP notification configuration.',
    schema: zDeleteSmtpConfigData,
    sdkFn: deleteSmtpConfig,
  },
  getWebhookNotification: {
    id: 'get_webhook_notification',
    description: 'Read-only. Get webhook notification configuration by type.',
    schema: zGetWebhookConfigData,
    sdkFn: getWebhookConfig,
    pathKeys: ['type'],
  },
  createWebhookNotification: {
    id: 'create_webhook_notification',
    description: 'Mutating. Create a webhook notification configuration.',
    schema: zCreateWebhookConfigData,
    sdkFn: createWebhookConfig,
  },
  updateWebhookNotification: {
    id: 'update_webhook_notification',
    description: 'Mutating. Update a webhook notification configuration.',
    schema: zUpdateWebhookConfigData,
    sdkFn: updateWebhookConfig,
  },
  deleteWebhookNotification: {
    id: 'delete_webhook_notification',
    description: 'Mutating and destructive. Delete a webhook notification configuration.',
    schema: zDeleteWebhookConfigData,
    sdkFn: deleteWebhookConfig,
  },
});

export const getNotificationPreferencesTool = tools.getNotificationPreferences;
export const updateNotificationPreferencesTool = tools.updateNotificationPreferences;
export const getSmtpConfigTool = tools.getSmtpConfig;
export const createSmtpConfigTool = tools.createSmtpConfig;
export const updateSmtpConfigTool = tools.updateSmtpConfig;
export const deleteSmtpConfigTool = tools.deleteSmtpConfig;
export const getWebhookNotificationTool = tools.getWebhookNotification;
export const createWebhookNotificationTool = tools.createWebhookNotification;
export const updateWebhookNotificationTool = tools.updateWebhookNotification;
export const deleteWebhookNotificationTool = tools.deleteWebhookNotification;
export const notificationConfigTools = tools;
