import type { LockRow } from "../models/lock";
import type { D1Result } from "./types";
import { getTransactionDb, withTransaction } from "../transaction";

export interface LockCreateRequest {
  lock_name?: string;
  album_title?: string;
  seal_date?: string | null;
  user_id?: number | null;
}

export interface LockUpdateRequest {
  lock_name?: string;
  album_title?: string;
  seal_date?: string | null;
  user_id?: number | null;
  upgraded_storage?: boolean;
}

export class LockRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: number, txDb?: D1Database): Promise<LockRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<LockRow> = await db
      .prepare("SELECT * FROM locks WHERE id = ?")
      .bind(id)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByUserId(userId: number, offset = 0, limit = 50, txDb?: D1Database): Promise<LockRow[]> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<LockRow> = await db
      .prepare("SELECT * FROM locks WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(userId, limit, offset)
      .all();

    if (!result.success) {
      throw new Error("Failed to fetch locks");
    }

    return result.results;
  }

  async countByUserId(userId: number, txDb?: D1Database): Promise<number> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("SELECT COUNT(*) as count FROM locks WHERE user_id = ?")
      .bind(userId)
      .first<{ count: number }>();

    return result?.count ?? 0;
  }

  async findAllByUserId(userId: number, txDb?: D1Database): Promise<LockRow[]> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<LockRow> = await db
      .prepare("SELECT * FROM locks WHERE user_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all();

    if (!result.success) {
      throw new Error("Failed to fetch all locks");
    }

    return result.results;
  }

  async clearUserAssociation(userId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE locks SET user_id = NULL WHERE user_id = ?")
      .bind(userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to clear user association");
    }
  }

  async create(data: LockCreateRequest, txDb?: D1Database): Promise<LockRow> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();
    const payload = {
      lock_name: data.lock_name ?? "Memory Lock",
      album_title: data.album_title ?? "Wonderful Memories",
      seal_date: data.seal_date ?? null,
      scan_count: 0,
      created_at: now,
      user_id: data.user_id ?? null,
      upgraded_storage: 0,
    };

    const result: D1Result = await db
      .prepare(
        `INSERT INTO locks (
          lock_name, album_title, seal_date,
          scan_count, created_at, user_id
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        payload.lock_name,
        payload.album_title,
        payload.seal_date,
        payload.scan_count,
        payload.created_at,
        payload.user_id
      )
      .run();

    if (!result.success) {
      throw new Error("Failed to create lock");
    }

    const created = await this.findById(result.meta.last_row_id!, db);
    if (!created) {
      throw new Error("Failed to load created lock");
    }

    return created;
  }

  async update(id: number, data: LockUpdateRequest, txDb?: D1Database): Promise<LockRow> {
    const db = getTransactionDb(this.db, txDb);
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.lock_name !== undefined) {
      fields.push("lock_name = ?");
      values.push(data.lock_name);
    }

    if (data.album_title !== undefined) {
      fields.push("album_title = ?");
      values.push(data.album_title);
    }

    if (data.seal_date !== undefined) {
      fields.push("seal_date = ?");
      values.push(data.seal_date);
    }

    if (data.user_id !== undefined) {
      fields.push("user_id = ?");
      values.push(data.user_id);
    }

    if (data.upgraded_storage !== undefined) {
      fields.push("upgraded_storage = ?");
      values.push(data.upgraded_storage ? 1 : 0);
    }

    if (fields.length === 0) {
      throw new Error("No fields provided for lock update");
    }

    values.push(id);

    const query = `UPDATE locks SET ${fields.join(", ")} WHERE id = ?`;
    const result = await db.prepare(query).bind(...values).run();

    if (!result.success) {
      throw new Error("Failed to update lock");
    }

    const updated = await this.findById(id, db);
    if (!updated) {
      throw new Error("Failed to load updated lock");
    }

    return updated;
  }

  async delete(id: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db.prepare("DELETE FROM locks WHERE id = ?").bind(id).run();
    if (!result.success) {
      throw new Error("Failed to delete lock");
    }
  }

  /**
   * Atomically increment scan count and update milestone if reached.
   * Wraps scan increment + milestone update in a transaction.
   */
  async incrementScanCount(id: number, txDb?: D1Database): Promise<{ lock: LockRow; milestoneReached: number | null }> {
    const db = getTransactionDb(this.db, txDb);

    // If no external transaction, wrap in our own transaction
    if (!txDb) {
      return withTransaction(this.db, async (tx) => {
        return this.incrementScanCount(id, tx);
      });
    }

    // Inside transaction - execute atomically
    // Use atomic SQL increment to avoid race conditions
    const result = await db
      .prepare("UPDATE locks SET scan_count = scan_count + 1 WHERE id = ? RETURNING *")
      .bind(id)
      .first<LockRow>();

    if (!result) {
      throw new Error("Lock not found or failed to increment scan count");
    }

    const newScanCount = result.scan_count;
    const currentMilestone = result.last_scan_milestone ?? 0;

    // Milestone thresholds (must match src/business/constants/milestones.ts)
    const milestones = [1, 25, 50, 75, 100, 250, 500, 750, 1000];
    const milestoneReached =
      milestones.includes(newScanCount) && newScanCount > currentMilestone ? newScanCount : null;

    // Update milestone if reached (within same transaction)
    if (milestoneReached) {
      await db
        .prepare("UPDATE locks SET last_scan_milestone = ? WHERE id = ?")
        .bind(milestoneReached, id)
        .run();

      // Fetch updated lock with new milestone
      const updatedLock = await this.findById(id, db);
      if (!updatedLock) {
        throw new Error("Lock not found after milestone update");
      }
      return { lock: updatedLock, milestoneReached };
    }

    return { lock: result, milestoneReached: null };
  }

  async getLastLock(): Promise<LockRow | null> {
    const result: D1Result<LockRow> = await this.db
      .prepare("SELECT * FROM locks ORDER BY id DESC LIMIT 1")
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }
}

