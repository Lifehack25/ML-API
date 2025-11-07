import { Hono } from "hono";
import type { Context } from "hono";
import { jwt } from "hono/jwt";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import type { AppConfig } from "../../config/env";
import { respondFromService, ok, fail } from "../http/responses";
import { getContainer, getUserId } from "../http/context";
import { createLockKeyAuth, setUserContext, idempotencyMiddleware } from "../http/middleware";
import { z } from "zod";
import { rateLimiters } from "../http/rateLimit";
import type {
  LockConnectUserRequest,
  PublishMetadataRequest,
  UpdateLockNameRequest,
} from "../../business/dtos/locks";
import { MetadataChangeType } from "../../business/dtos/locks";
import { mapLockRowToSummary } from "../../data/mappers/lock-mapper";
import { requireNumericParam, validateJson } from "../http/validation";
import { invalidateAlbumCache } from "../../infrastructure/cache-invalidation";

const ensureLockOwnership = async (c: Context<{ Bindings: EnvBindings; Variables: AppVariables }>, lockId: number): Promise<true | Response> => {
  const userId = getUserId(c);
  const lock = await getContainer(c).repositories.locks.findById(lockId);
  if (!lock) {
    return fail(c, "Lock not found", 404, null);
  }

  if (lock.user_id !== userId) {
    return fail(c, "Forbidden", 403, null);
  }

  return true;
};

const connectLockSchema = z.object({
  hashedLockId: z.string().trim().min(1, "hashedLockId is required"),
});

const metadataChangeSchema = z.object({
  changeType: z.nativeEnum(MetadataChangeType),
  mediaId: z.number().int().positive().optional().nullable(),
  cloudflareId: z.string().trim().min(1).optional().nullable(),
  isImage: z.boolean().optional().nullable(),
  newDisplayOrder: z.number().int().nonnegative().optional().nullable(),
  isMainImage: z.boolean().optional().nullable(),
});

const publishSchema = z.object({
  lockId: z.number().int().positive(),
  albumTitle: z.string().trim().max(200).optional().nullable(),
  changes: z.array(metadataChangeSchema),
});

const updateNameSchema = z.object({
  lockId: z.number().int().positive(),
  newName: z.string().trim().min(1).max(120),
});

const upgradeBodySchema = z.object({
  lockId: z.number().int().positive(),
});

export const createLockRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();
  const jwtMiddleware = jwt({ secret: config.jwt.secret, alg: "HS256" });
  const attachUser = setUserContext();

  // Get all locks owned by the authenticated user.
  router.get(
    "/user/:userId{[0-9]+}",
    rateLimiters.apiRead,
    jwtMiddleware,
    attachUser,
    requireNumericParam("userId", { min: 1, message: "Invalid user ID" }),
    async (c) => {
      const { userId: requestedUserId } = c.req.valid("param") as { userId: number };

      if (requestedUserId !== getUserId(c)) {
        return fail(c, "Forbidden", 403, []);
      }

      const result = await getContainer(c).services.locks.getUserLocks(requestedUserId);
      return respondFromService(c, result);
    }
  );

  // Update the name of a lock.
  router.patch(
    "/name",
    rateLimiters.apiWrite,
    jwtMiddleware,
    attachUser,
    validateJson(updateNameSchema),
    async (c) => {
      const payload = c.req.valid("json") as UpdateLockNameRequest;
      const ownership = await ensureLockOwnership(c, payload.lockId);
      if (ownership !== true) {
        return ownership;
      }
      const result = await getContainer(c).services.locks.updateLockName(payload);
      return respondFromService(c, result);
    }
  );

  // Toggle the seal date for a lock.
  router.patch(
    "/:lockId{[0-9]+}/seal",
    rateLimiters.apiWrite,
    jwtMiddleware,
    attachUser,
    requireNumericParam("lockId", { min: 1, message: "Invalid lock ID" }),
    async (c) => {
      const { lockId } = c.req.valid("param") as { lockId: number };
      const ownership = await ensureLockOwnership(c, lockId);
      if (ownership !== true) {
        return ownership;
      }
      const result = await getContainer(c).services.locks.toggleSealDate(lockId);
      return respondFromService(c, result);
    }
  );

  // Upgrade lock storage tier using a path parameter.
  router.patch(
    "/upgrade-storage/:lockId{[0-9]+}",
    rateLimiters.apiWrite,
    jwtMiddleware,
    attachUser,
    requireNumericParam("lockId", { min: 1, message: "Invalid lock ID" }),
    async (c) => {
      const { lockId } = c.req.valid("param") as { lockId: number };
      const ownership = await ensureLockOwnership(c, lockId);
      if (ownership !== true) {
        return ownership;
      }
      const result = await getContainer(c).services.locks.upgradeStorage(lockId);
      return respondFromService(c, result);
    }
  );

  // REMOVED: PATCH /upgrade-storage (body parameter version)
  // This was a duplicate of the path parameter version above.
  // MAUI app uses: PATCH /locks/upgrade-storage/:lockId

  // Link a scanned lock to the current user by hashed ID.
  router.post(
    "/connect/user",
    rateLimiters.apiWrite,
    jwtMiddleware,
    attachUser,
    validateJson(connectLockSchema),
    async (c) => {
      const { hashedLockId } = c.req.valid("json") as LockConnectUserRequest;

      const result = await getContainer(c).services.locks.connectLockToUser(
        getUserId(c),
        hashedLockId.trim()
      );
      return respondFromService(c, result);
    }
  );

  // Publish album metadata changes (reorders, deletions, etc.).
  router.post(
    "/publish",
    idempotencyMiddleware,
    rateLimiters.apiWrite,
    jwtMiddleware,
    attachUser,
    validateJson(publishSchema),
    async (c) => {
      const payload = c.req.valid("json") as PublishMetadataRequest;
      if (!payload?.lockId || !Number.isFinite(payload.lockId)) {
        return fail(c, "Invalid lock ID", 400, null);
      }
      const ownership = await ensureLockOwnership(c, payload.lockId);
      if (ownership !== true) {
        return ownership;
      }
      const result = await getContainer(c).services.locks.publishMetadata(payload);

      // Invalidate album cache immediately after successful publish
      if (result.ok) {
        const container = getContainer(c);
        const hashedId = container.hashids.encode(payload.lockId);
        await invalidateAlbumCache(hashedId);
      }

      return respondFromService(c, result);
    }
  );

  // Upload a single media item to a lock album.
  router.post(
    "/media",
    idempotencyMiddleware,
    rateLimiters.mediaUpload,
    jwtMiddleware,
    attachUser,
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      const lockId = Number(form.get("lockId"));
      if (!Number.isFinite(lockId)) {
        return fail(c, "Invalid lock ID", 400);
      }
      const displayOrder = Number(form.get("displayOrder")) || 0;
      const isMainImage = form.get("isMainImage") === "true";
      const durationSecondsValue = form.get("durationSeconds");
      let durationSeconds: number | undefined;
      if (typeof durationSecondsValue === "string" && durationSecondsValue.trim().length > 0) {
        const parsed = Number(durationSecondsValue);
        if (Number.isFinite(parsed)) {
          durationSeconds = parsed;
        }
      }

      if (!(file instanceof File)) {
        return fail(c, "File field is required", 400);
      }

      const ownership = await ensureLockOwnership(c, lockId);
      if (ownership !== true) {
        return ownership;
      }

      const result = await getContainer(c).services.locks.uploadSingleMedia({
        lockId,
        file,
        displayOrder,
        isMainImage,
        durationSeconds,
      });

      return respondFromService(c, result);
    }
  );

  // Retrieve a single lock owned by the current user.
  router.get(
    "/:lockId{[0-9]+}",
    rateLimiters.apiRead,
    jwtMiddleware,
    attachUser,
    requireNumericParam("lockId", { min: 1, message: "Invalid lock ID" }),
    async (c) => {
      const { lockId } = c.req.valid("param") as { lockId: number };
      const ownership = await ensureLockOwnership(c, lockId);
      if (ownership !== true) {
        return ownership;
      }

      const container = getContainer(c);
      const lock = await container.repositories.locks.findById(lockId);
      if (!lock) {
        return fail(c, "Lock not found", 404, null);
      }

      return ok(c, mapLockRowToSummary(lock, container.hashids), "Lock retrieved successfully");
    }
  );

  // Provide validation data for upcoming media uploads.
  router.get(
    "/:lockId{[0-9]+}/validation-data",
    rateLimiters.apiRead,
    jwtMiddleware,
    attachUser,
    requireNumericParam("lockId", { min: 1, message: "Invalid lock ID" }),
    async (c) => {
      const { lockId } = c.req.valid("param") as { lockId: number };
      const ownership = await ensureLockOwnership(c, lockId);
      if (ownership !== true) {
        return ownership;
      }
      const result = await getContainer(c).services.locks.getValidationData(lockId);
      return respondFromService(c, result);
    }
  );

  // Provision new lock IDs using the create-lock API key.
  router.post(
    "/create/:totalLocks{[0-9]+}",
    idempotencyMiddleware,
    rateLimiters.batch,
    createLockKeyAuth(config),
    requireNumericParam("totalLocks", { min: 1, max: 10000, message: "Invalid totalLocks parameter. Must be between 1 and 10000." }),
    async (c) => {
      const { totalLocks } = c.req.valid("param") as { totalLocks: number };

      const lockRepo = getContainer(c).repositories.locks;
      const createdIds: number[] = [];

      for (let i = 0; i < totalLocks; i++) {
        const created = await lockRepo.create({});
        createdIds.push(created.id);
      }

      return ok(
        c,
        {
          createdCount: createdIds.length,
          minId: createdIds[0],
          maxId: createdIds[createdIds.length - 1],
        },
        `Successfully created ${createdIds.length} locks`
      );
    }
  );

  return router;
};
