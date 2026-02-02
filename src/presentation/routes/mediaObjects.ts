import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { z } from 'zod';
import type { EnvBindings } from '../../common/bindings';
import type { AppVariables } from '../../common/context';
import type { AppConfig } from '../../config/env';
import { setUserContext, idempotencyMiddleware } from '../http/middleware';
import { getContainer } from '../http/context';
import type { ApiError } from '../http/responses';
import { requireNumericParam, validateJson } from '../http/validation';

const createMediaSchema = z.object({
  lockId: z.number().int().positive(),
  cloudflareId: z.string().trim().optional().nullable(),
  url: z.string().trim().optional().nullable(),
  thumbnailUrl: z.string().trim().optional().nullable(),
  fileName: z.string().trim().optional().nullable(),
  isImage: z.boolean().optional(),
  isMainImage: z.boolean().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional().nullable(),
});

const updateMediaSchema = z.object({
  url: z.string().trim().optional().nullable(),
  displayOrder: z.number().int().optional(),
  isMainImage: z.boolean().optional(),
});

const batchReorderSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    displayOrder: z.number().int(),
  })
);

const albumTitleSchema = z.object({
  albumTitle: z.string().trim().min(1),
});

export const createMediaObjectRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();
  const jwtMiddleware = jwt({ secret: config.jwt.secret, alg: 'HS256' });
  const attachUser = setUserContext();

  // Create a new media object record.
  router.post('/', jwtMiddleware, attachUser, validateJson(createMediaSchema), async (c) => {
    const payload = c.req.valid('json') as z.infer<typeof createMediaSchema>;

    const mediaRepo = getContainer(c).repositories.media;
    const created = await mediaRepo.create({
      lock_id: payload.lockId,
      cloudflare_id: payload.cloudflareId ?? '',
      url: payload.url ?? '',
      thumbnail_url: payload.thumbnailUrl ?? null,
      file_name: payload.fileName ?? null,
      is_image: payload.isImage ?? true,
      is_main_picture: payload.isMainImage ?? false,
      display_order: payload.displayOrder ?? 0,
      duration_seconds: payload.durationSeconds ?? null,
    });

    return c.json(
      {
        id: created.id,
        lockId: created.lock_id,
        url: created.url,
        thumbnailUrl: created.thumbnail_url,
        type: created.is_image ? 'image' : 'video',
        isMainImage: Boolean(created.is_main_picture),
        displayOrder: created.display_order,
        durationSeconds: created.duration_seconds,
      },
      200
    );
  });

  // Update metadata for an existing media object.
  router.patch(
    '/:id{[0-9]+}',
    jwtMiddleware,
    attachUser,
    requireNumericParam('id', { min: 1, message: 'Invalid media ID' }),
    validateJson(updateMediaSchema),
    async (c) => {
      const { id } = c.req.valid('param') as { id: number };
      const payload = c.req.valid('json') as z.infer<typeof updateMediaSchema>;
      const mediaRepo = getContainer(c).repositories.media;
      const updated = await mediaRepo.update(id, {
        url: payload.url ?? undefined,
        display_order: payload.displayOrder ?? undefined,
        is_main_picture: payload.isMainImage ?? undefined,
      });

      return c.json(
        {
          id: updated.id,
          url: updated.url,
          displayOrder: updated.display_order,
          isMainImage: Boolean(updated.is_main_picture),
        },
        200
      );
    }
  );

  // Delete a media object and cascade clean-up.
  router.delete(
    '/:id{[0-9]+}',
    idempotencyMiddleware,
    jwtMiddleware,
    attachUser,
    requireNumericParam('id', { min: 1, message: 'Invalid media ID' }),
    async (c) => {
      const { id } = c.req.valid('param') as { id: number };
      const result = await getContainer(c).services.locks.deleteMedia(id);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Batch update media display order values.
  router.post(
    '/batch-reorder',
    jwtMiddleware,
    attachUser,
    validateJson(batchReorderSchema),
    async (c) => {
      const updates = c.req.valid('json') as Array<{ id: number; displayOrder: number }>;
      const result = await getContainer(c).services.locks.batchReorder(updates);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  // Update the album title for a specific lock.
  router.patch(
    '/locks/:lockId{[0-9]+}/album-title',
    jwtMiddleware,
    attachUser,
    requireNumericParam('lockId', { min: 1, message: 'Invalid lock ID' }),
    validateJson(albumTitleSchema),
    async (c) => {
      const { lockId } = c.req.valid('param') as { lockId: number };
      const { albumTitle } = c.req.valid('json') as { albumTitle: string };
      const result = await getContainer(c).services.locks.updateAlbumTitle(lockId, albumTitle);
      if (result.ok) {
        return c.json(result.data, result.status ?? 200);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, result.status ?? 400);
    }
  );

  return router;
};
