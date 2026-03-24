import { z } from 'zod';
import { sendNotification } from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';
import { getClient } from './shared';

function sendViaChannel(
  channel: string,
  input: Record<string, unknown>,
  ctx: unknown,
) {
  return sendNotification({
    client: getClient(ctx) as any,
    body: { channel, message: input.message as string, subject: input.subject as string | undefined, to: input.to as string | undefined, metadata: input.metadata as Record<string, string> | undefined },
  }).then((r: any) => r?.data ?? r);
}

const tools = defineToolGroup({
  sendSlackNotification: {
    id: 'send_slack_notification',
    description:
      'Send a notification message to the user\'s configured Slack channel via webhook. ' +
      'Requires the user to have an active Slack webhook configured in their notification settings.',
    schema: z.object({
      message: z.string().describe('The message to send to Slack'),
    }),
    sdkFn: sendNotification,
    execute: async (input: any, ctx: unknown) => sendViaChannel('slack', input, ctx),
  },
  sendDiscordNotification: {
    id: 'send_discord_notification',
    description:
      'Send a notification message to the user\'s configured Discord channel via webhook. ' +
      'Requires the user to have an active Discord webhook configured in their notification settings.',
    schema: z.object({
      message: z.string().describe('The message to send to Discord'),
    }),
    sdkFn: sendNotification,
    execute: async (input: any, ctx: unknown) => sendViaChannel('discord', input, ctx),
  },
  sendEmailNotification: {
    id: 'send_email_notification',
    description:
      'Send a notification email using the user\'s configured SMTP settings. ' +
      'Requires the user to have SMTP configured in their notification settings. ' +
      'If no recipient is specified, the email is sent to the authenticated user\'s email address.',
    schema: z.object({
      message: z.string().describe('The email body content'),
      subject: z.string().optional().describe('The email subject line. Defaults to "Notification from Nixopus"'),
      to: z.string().optional().describe('Recipient email address. Defaults to the authenticated user\'s email'),
    }),
    sdkFn: sendNotification,
    execute: async (input: any, ctx: unknown) => sendViaChannel('email', input, ctx),
  },
  sendNotification: {
    id: 'send_notification',
    description:
      'Send a notification through a specified channel (slack, discord, or email). ' +
      'Use this when you want to dynamically choose the notification channel. ' +
      'The user must have the chosen channel configured in their notification settings.',
    schema: z.object({
      channel: z.enum(['slack', 'discord', 'email']).describe('The notification channel to use'),
      message: z.string().describe('The notification message'),
      subject: z.string().optional().describe('Email subject (only used for email channel)'),
      to: z.string().optional().describe('Recipient email (only used for email channel)'),
      metadata: z.record(z.string(), z.string()).optional().describe('Optional key-value metadata'),
    }),
    sdkFn: sendNotification,
    execute: async (input: any, ctx: unknown) => sendViaChannel(input.channel, input, ctx),
  },
});

export const sendSlackNotificationTool = tools.sendSlackNotification;
export const sendDiscordNotificationTool = tools.sendDiscordNotification;
export const sendEmailNotificationTool = tools.sendEmailNotification;
export const sendNotificationTool = tools.sendNotification;
export const notificationTools = tools;
