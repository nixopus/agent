import type { ApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { syncFiles, countFiles, remapPrefix, setIndexStatus, getIndexStatus, isS3Configured } from './s3-store';
import { createLogger } from '../../logger';

const logger = createLogger('workspace-routes');

const SyncBodySchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(['base64']).optional(),
  })),
  fullSync: z.boolean().optional(),
  deletedPaths: z.array(z.string()).optional(),
});

const IndexS3BodySchema = z.object({
  applicationId: z.string().min(1),
});

const RemapBodySchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
});

export const workspaceRoutes: ApiRoute[] = [
  {
    path: '/workspace/:applicationId/sync',
    method: 'POST',
    createHandler: async () => async (c) => {
      if (!isS3Configured()) {
        return c.json({ error: 'S3 storage is not configured' }, 503 as 503);
      }

      const applicationId = c.req.param('applicationId');
      if (!applicationId) {
        return c.json({ error: 'applicationId is required' }, 400 as 400);
      }

      let body: z.infer<typeof SyncBodySchema>;
      try {
        const raw = await c.req.json();
        const parsed = SyncBodySchema.safeParse(raw);
        if (!parsed.success) {
          const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
          return c.json({ error: 'Invalid request body', detail }, 400 as 400);
        }
        body = parsed.data;
      } catch {
        return c.json({ error: 'Invalid JSON' }, 400 as 400);
      }

      try {
        const synced = await syncFiles(
          applicationId,
          body.files,
          body.fullSync ?? false,
          body.deletedPaths,
        );

        logger.info({ applicationId, synced, fullSync: body.fullSync }, 'Workspace sync complete');
        return c.json({ synced });
      } catch (err) {
        logger.error({ applicationId, err }, 'Workspace sync failed');
        return c.json({ error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) }, 500 as 500);
      }
    },
  },

  {
    path: '/index/s3',
    method: 'POST',
    createHandler: async () => async (c) => {
      if (!isS3Configured()) {
        return c.json({ error: 'S3 storage is not configured' }, 503 as 503);
      }

      let applicationId: string;
      try {
        const raw = await c.req.json();
        const parsed = IndexS3BodySchema.safeParse(raw);
        if (!parsed.success) {
          return c.json({ error: 'applicationId is required' }, 400 as 400);
        }
        applicationId = parsed.data.applicationId;
      } catch {
        return c.json({ error: 'Invalid JSON' }, 400 as 400);
      }

      setIndexStatus(applicationId, 'indexing');

      countFiles(applicationId)
        .then((fileCount) => {
          setIndexStatus(applicationId, 'done', fileCount);
          logger.info({ applicationId, fileCount }, 'S3 index complete');
        })
        .catch((err) => {
          setIndexStatus(applicationId, 'error', undefined, err instanceof Error ? err.message : String(err));
          logger.error({ applicationId, err }, 'S3 index failed');
        });

      return c.json({ ok: true });
    },
  },

  {
    path: '/index/:applicationId',
    method: 'GET',
    createHandler: async () => async (c) => {
      const applicationId = c.req.param('applicationId');
      if (!applicationId) {
        return c.json({ error: 'applicationId is required' }, 400 as 400);
      }

      const status = getIndexStatus(applicationId);
      return c.json(status);
    },
  },

  {
    path: '/workspace/remap',
    method: 'POST',
    createHandler: async () => async (c) => {
      if (!isS3Configured()) {
        return c.json({ error: 'S3 storage is not configured' }, 503 as 503);
      }

      let body: z.infer<typeof RemapBodySchema>;
      try {
        const raw = await c.req.json();
        const parsed = RemapBodySchema.safeParse(raw);
        if (!parsed.success) {
          return c.json({ error: 'fromId and toId are required' }, 400 as 400);
        }
        body = parsed.data;
      } catch {
        return c.json({ error: 'Invalid JSON' }, 400 as 400);
      }

      try {
        const copied = await remapPrefix(body.fromId, body.toId);
        logger.info({ fromId: body.fromId, toId: body.toId, copied }, 'Workspace remap complete');
        return c.json({ copied, fromId: body.fromId, toId: body.toId });
      } catch (err) {
        logger.error({ fromId: body.fromId, toId: body.toId, err }, 'Workspace remap failed');
        return c.json({ error: 'Remap failed', detail: err instanceof Error ? err.message : String(err) }, 500 as 500);
      }
    },
  },
];
