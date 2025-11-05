import type { MediaObjectRow } from "../models/media-object";
import type { D1Result } from "./types";
import { getTransactionDb, withTransaction } from "../transaction";

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
  constructor(private readonly db: D1Database) {}

  async findById(id: number, txDb?: D1Database): Promise<MediaObjectRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<MediaObjectRow> = await db
      .prepare("SELECT * FROM media_objects WHERE id = ?")
      .bind(id)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByLockId(lockId: number, limit = 100, txDb?: D1Database): Promise<MediaObjectRow[]> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<MediaObjectRow> = await db
      .prepare(
        "SELECT * FROM media_objects WHERE lock_id = ? ORDER BY display_order ASC, created_at DESC LIMIT ?"
      )
      .bind(lockId, limit)
      .all();

    if (!result.success) {
      throw new Error("Failed to fetch media objects");
    }

    return result.results;
  }

  private async unsetMainPicture(lockId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE media_objects SET is_main_picture = 0 WHERE lock_id = ? AND is_main_picture = 1")
      .bind(lockId)
      .run();

    if (!result.success) {
      throw new Error("Failed to unset current main picture");
    }
  }

  /**
   * Create a new media object. If setting as main picture, unsets current main picture atomically.
   * Can participate in external transaction if txDb provided.
   */
  async create(request: MediaCreateRequest, txDb?: D1Database): Promise<MediaObjectRow> {
    const db = getTransactionDb(this.db, txDb);

    // If no external transaction, wrap in our own transaction
    if (!txDb) {
      return withTransaction(this.db, async (tx) => {
        return this.create(request, tx);
      });
    }

    // Inside transaction - execute operations
    if (request.is_main_picture) {
      await this.unsetMainPicture(request.lock_id, db);
    }

    const now = new Date().toISOString();

    const result: D1Result = await db
      .prepare(
        `INSERT INTO media_objects (
          lock_id, cloudflare_id, url, thumbnail_url, file_name,
          is_image, is_main_picture, created_at, display_order, duration_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        request.lock_id,
        request.cloudflare_id,
        request.url,
        request.thumbnail_url ?? null,
        request.file_name ?? null,
        request.is_image === false ? 0 : 1,
        request.is_main_picture === true,
        now,
        request.display_order ?? 0,
        request.duration_seconds ?? null
      )
      .run();

    if (!result.success) {
      throw new Error("Failed to create media object");
    }

    const created = await this.findById(result.meta.last_row_id!, db);
    if (!created) {
      throw new Error("Failed to load created media object");
    }

    return created;
  }

  /**
   * Update a media object. If setting as main picture, unsets current main picture atomically.
   * Can participate in external transaction if txDb provided.
   */
  async update(id: number, request: MediaUpdateRequest, txDb?: D1Database): Promise<MediaObjectRow> {
    const db = getTransactionDb(this.db, txDb);

    // If no external transaction, wrap in our own transaction
    if (!txDb) {
      return withTransaction(this.db, async (tx) => {
        return this.update(id, request, tx);
      });
    }

    // Inside transaction - execute operations
    const current = await this.findById(id, db);
    if (!current) {
      throw new Error("Media object not found");
    }

    if (request.is_main_picture === true) {
      await this.unsetMainPicture(current.lock_id, db);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (request.cloudflare_id !== undefined) {
      fields.push("cloudflare_id = ?");
      values.push(request.cloudflare_id);
    }
    if (request.url !== undefined) {
      fields.push("url = ?");
      values.push(request.url);
    }
    if (request.thumbnail_url !== undefined) {
      fields.push("thumbnail_url = ?");
      values.push(request.thumbnail_url);
    }
    if (request.file_name !== undefined) {
      fields.push("file_name = ?");
      values.push(request.file_name);
    }
    if (request.is_image !== undefined) {
      fields.push("is_image = ?");
      values.push(request.is_image ? 1 : 0);
    }
    if (request.is_main_picture !== undefined) {
      fields.push("is_main_picture = ?");
      values.push(request.is_main_picture ? 1 : 0);
    }
    if (request.display_order !== undefined) {
      fields.push("display_order = ?");
      values.push(request.display_order);
    }
    if (request.duration_seconds !== undefined) {
      fields.push("duration_seconds = ?");
      values.push(request.duration_seconds);
    }

    if (fields.length === 0) {
      throw new Error("No fields provided for media update");
    }

    values.push(id);

    const query = `UPDATE media_objects SET ${fields.join(", ")} WHERE id = ?`;
    const result = await db.prepare(query).bind(...values).run();

    if (!result.success) {
      throw new Error("Failed to update media object");
    }

    const updated = await this.findById(id, db);
    if (!updated) {
      throw new Error("Failed to load updated media object");
    }

    return updated;
  }

  async delete(id: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db.prepare("DELETE FROM media_objects WHERE id = ?").bind(id).run();
    if (!result.success) {
      throw new Error("Failed to delete media object");
    }
  }

  async deleteByLockId(lockId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("DELETE FROM media_objects WHERE lock_id = ?")
      .bind(lockId)
      .run();
    if (!result.success) {
      throw new Error("Failed to delete lock media objects");
    }
  }

  /**
   * Batch reorder media objects atomically.
   * Uses true transaction instead of D1 batch API for all-or-nothing guarantee.
   * Can participate in external transaction if txDb provided.
   */
  async batchReorder(updates: Array<{ id: number; displayOrder: number }>, txDb?: D1Database): Promise<number> {
    if (updates.length === 0) return 0;

    const db = getTransactionDb(this.db, txDb);

    // If no external transaction, wrap in our own transaction
    if (!txDb) {
      return withTransaction(this.db, async (tx) => {
        return this.batchReorder(updates, tx);
      });
    }

    // Inside transaction - execute all updates
    let successCount = 0;
    for (const update of updates) {
      const result = await db
        .prepare("UPDATE media_objects SET display_order = ? WHERE id = ?")
        .bind(update.displayOrder, update.id)
        .run();

      if (result.success) {
        successCount++;
      } else {
        // Fail entire transaction if any update fails
        throw new Error(`Failed to reorder media object ${update.id}`);
      }
    }

    return successCount;
  }
}

