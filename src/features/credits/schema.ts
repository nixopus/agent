import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';

export const aiUsageLogs = pgTable('ai_usage_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id'),
  modelId: varchar('model_id', { length: 255 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costUsd: numeric('cost_usd').notNull().default('0'),
  requestType: varchar('request_type', { length: 100 }),
  agentId: varchar('agent_id', { length: 255 }),
  workflowId: varchar('workflow_id', { length: 255 }),
  sessionId: varchar('session_id', { length: 255 }),
  latencyMs: integer('latency_ms'),
  status: varchar('status', { length: 50 }).default('success'),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  entryType: varchar('entry_type', { length: 10 }).notNull(),
  balanceAfterCents: integer('balance_after_cents').notNull(),
  reason: varchar('reason', { length: 255 }),
  referenceId: varchar('reference_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const autoTopupSettings = pgTable('auto_topup_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  thresholdCents: integer('threshold_cents').notNull().default(200),
  amountCents: integer('amount_cents').notNull().default(1000),
  subscriptionId: varchar('subscription_id', { length: 255 }),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
