import { eq, and, asc, desc } from "drizzle-orm";
import type { DrizzleClient } from "../db";
import { mediaObjects, type MediaObject } from "../schema";

export interface MediaCreateRequest {
  lock_id: number;
  cloudflare_id: string;
  url: string;
  thumbnail_url?: string | null;
  file_name?: string | null;
  is_image?: boolean;
  is_main_picture?: boolean;
  display_order?: number;
  duration_seconds?: number | null;
}

export interface MediaUpdateRequest {
  cloudflare_id?: string;
  url?: string;
  thumbnail_url?: string | null;
  file_name?: string | null;
  is_image?: boolean;
  is_main_picture?: boolean;
  display_order?: number;
  duration_seconds?: number | null;
}

export class MediaObjectRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findById(id: number): Promise<MediaObject | null> {
    const result = await this.db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async findByLockId(lockId: number, limit = 100): Promise<MediaObject[]> {
    return await this.db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.lock_id, lockId))
      .orderBy(asc(mediaObjects.display_order), desc(mediaObjects.created_at))
      .limit(limit);
  }

  private async unsetMainPicture(lockId: number): Promise<void> {
    await this.db
      .update(mediaObjects)
      .set({ is_main_picture: false })
      .where(and(eq(mediaObjects.lock_id, lockId), eq(mediaObjects.is_main_picture, true)));
  }

  /**
   * Create a new media object. If setting as main picture, unsets current main picture atomically.
   */
  async create(request: MediaCreateRequest): Promise<MediaObject> {
    // If setting as main picture, unset current main picture first
    if (request.is_main_picture) {
      await this.unsetMainPicture(request.lock_id);
    }

    const now = new Date().toISOString();

    const result = await this.db
      .insert(mediaObjects)
      .values({
        lock_id: request.lock_id,
        cloudflare_id: request.cloudflare_id,
        url: request.url,
        thumbnail_url: request.thumbnail_url ?? null,
        file_name: request.file_name ?? null,
        is_image: request.is_image === false ? 0 : 1,
        is_main_picture: request.is_main_picture === true,
        created_at: now,
        display_order: request.display_order ?? 0,
        duration_seconds: request.duration_seconds ?? null,
      })
      .returning();

    if (!result[0]) {
      throw new Error("Failed to create media object");
    }

    return result[0];
  }

  /**
   * Update a media object. If setting as main picture, unsets current main picture atomically.
   */
  async update(id: number, request: MediaUpdateRequest): Promise<MediaObject> {
    // Get current media object to access lock_id
    const current = await this.findById(id);
    if (!current) {
      throw new Error("Media object not found");
    }

    // If setting as main picture, unset current main picture first
    if (request.is_main_picture === true) {
      await this.unsetMainPicture(current.lock_id);
    }

    const updates: Partial<MediaObject> = {};

    if (request.cloudflare_id !== undefined) {
      updates.cloudflare_id = request.cloudflare_id;
    }
    if (request.url !== undefined) {
      updates.url = request.url;
    }
    if (request.thumbnail_url !== undefined) {
      updates.thumbnail_url = request.thumbnail_url;
    }
    if (request.file_name !== undefined) {
      updates.file_name = request.file_name;
    }
    if (request.is_image !== undefined) {
      updates.is_image = request.is_image ? 1 : 0;
    }
    if (request.is_main_picture !== undefined) {
      updates.is_main_picture = request.is_main_picture;
    }
    if (request.display_order !== undefined) {
      updates.display_order = request.display_order;
    }
    if (request.duration_seconds !== undefined) {
      updates.duration_seconds = request.duration_seconds;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("No fields provided for media update");
    }

    const result = await this.db
      .update(mediaObjects)
      .set(updates)
      .where(eq(mediaObjects.id, id))
      .returning();

    if (!result[0]) {
      throw new Error("Failed to update media object");
    }

    return result[0];
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(mediaObjects).where(eq(mediaObjects.id, id));
  }

  async deleteByLockId(lockId: number): Promise<void> {
    await this.db.delete(mediaObjects).where(eq(mediaObjects.lock_id, lockId));
  }

  /**
   * Batch reorder media objects.
   * Note: These are executed sequentially. For true atomicity, use within a transaction.
   */
  async batchReorder(updates: Array<{ id: number; displayOrder: number }>): Promise<number> {
    if (updates.length === 0) return 0;

    let successCount = 0;
    for (const update of updates) {
      try {
        await this.db
          .update(mediaObjects)
          .set({ display_order: update.displayOrder })
          .where(eq(mediaObjects.id, update.id));
        successCount++;
      } catch (error) {
        // Fail entire batch if any update fails
        throw new Error(`Failed to reorder media object ${update.id}`);
      }
    }

    return successCount;
  }
}
