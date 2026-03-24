import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const applicationContext = pgTable('application_context', {
  applicationId: uuid('application_id').primaryKey(),
  rootHash: text('root_hash'),
  simhash: text('simhash'),
  paths: jsonb('paths'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applicationFileChunks = pgTable('application_file_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull(),
  path: text('path').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  content: text('content').notNull(),
  chunkHash: varchar('chunk_hash', { length: 64 }).notNull(),
  language: varchar('language', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  host: varchar('host', { length: 255 }),
  user: varchar('user', { length: 255 }),
  port: integer('port').default(22),
  publicKey: text('public_key'),
  privateKeyEncrypted: text('private_key_encrypted'),
  passwordEncrypted: text('password_encrypted'),
  keyType: varchar('key_type', { length: 50 }).default('rsa'),
  keySize: integer('key_size').default(4096),
  fingerprint: varchar('fingerprint', { length: 255 }),
  authMethod: varchar('auth_method', { length: 50 }).notNull().default('key'),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});
