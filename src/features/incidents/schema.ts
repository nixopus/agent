import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 255 }).notNull().unique(),
  source: varchar('source', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }).notNull(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id'),
  status: varchar('status', { length: 50 }).notNull().default('received'),
  diagnosis: text('diagnosis'),
  prUrl: varchar('pr_url', { length: 500 }),
  errorPayload: jsonb('error_payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
