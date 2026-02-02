import { eq, desc, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../db';
import { locks, type Lock } from '../schema';

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
  geo_location?: string | null;
}

/**
 * Repository for managing Lock entities.
 * Handles database operations for albums/locks including creation, updates, and scan counting.
 */
export class LockRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findById(id: number): Promise<Lock | null> {
    const result = await this.db.select().from(locks).where(eq(locks.id, id)).limit(1);
    return result[0] ?? null;
  }

  async findByUserId(userId: number, offset = 0, limit = 50): Promise<Lock[]> {
    return await this.db
      .select()
      .from(locks)
      .where(eq(locks.user_id, userId))
      .orderBy(desc(locks.created_at))
      .limit(limit)
      .offset(offset);
  }

  async countByUserId(userId: number): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(locks)
      .where(eq(locks.user_id, userId));

    return result[0]?.count ?? 0;
  }

  async findAllByUserId(userId: number): Promise<Lock[]> {
    return await this.db
      .select()
      .from(locks)
      .where(eq(locks.user_id, userId))
      .orderBy(desc(locks.created_at));
  }

  async clearUserAssociation(userId: number): Promise<void> {
    await this.db.update(locks).set({ user_id: null }).where(eq(locks.user_id, userId));
  }

  async create(data: LockCreateRequest): Promise<Lock> {
    const now = new Date().toISOString();
    const payload = {
      lock_name: data.lock_name ?? 'Memory Lock',
      album_title: data.album_title ?? 'Wonderful Memories',
      seal_date: data.seal_date ?? null,
      scan_count: 0,
      created_at: now,
      user_id: data.user_id ?? null,
      upgraded_storage: 0,
      last_scan_milestone: 0,
    };

    const result = await this.db.insert(locks).values(payload).returning();

    if (!result[0]) {
      throw new Error('Failed to create lock');
    }

    return result[0];
  }

  async update(id: number, data: LockUpdateRequest): Promise<Lock> {
    const updates: Partial<Lock> = {};

    if (data.lock_name !== undefined) {
      updates.lock_name = data.lock_name;
    }

    if (data.album_title !== undefined) {
      updates.album_title = data.album_title;
    }

    if (data.seal_date !== undefined) {
      updates.seal_date = data.seal_date;
    }

    if (data.user_id !== undefined) {
      updates.user_id = data.user_id;
    }

    if (data.upgraded_storage !== undefined) {
      updates.upgraded_storage = data.upgraded_storage ? 1 : 0;
    }

    if (data.geo_location !== undefined) {
      updates.geo_location = data.geo_location;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields provided for lock update');
    }

    const result = await this.db.update(locks).set(updates).where(eq(locks.id, id)).returning();

    if (!result[0]) {
      throw new Error('Failed to update lock');
    }

    return result[0];
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(locks).where(eq(locks.id, id));
  }

  /**
   * Atomically increment scan count and update milestone if reached.
   * Uses raw SQL for atomic increment to avoid race conditions.
   */
  async incrementScanCount(id: number): Promise<{ lock: Lock; milestoneReached: number | null }> {
    // Use atomic SQL increment to avoid race conditions
    const result = await this.db
      .update(locks)
      .set({ scan_count: sql`${locks.scan_count} + 1` })
      .where(eq(locks.id, id))
      .returning();

    if (!result[0]) {
      throw new Error('Lock not found or failed to increment scan count');
    }

    const updatedLock = result[0];
    const newScanCount = updatedLock.scan_count;
    const currentMilestone = updatedLock.last_scan_milestone ?? 0;

    // Milestone thresholds (must match src/business/constants/milestones.ts)
    const milestones = [1, 25, 50, 75, 100, 250, 500, 750, 1000];
    const milestoneReached =
      milestones.includes(newScanCount) && newScanCount > currentMilestone ? newScanCount : null;

    // Update milestone if reached
    if (milestoneReached) {
      const finalResult = await this.db
        .update(locks)
        .set({ last_scan_milestone: milestoneReached })
        .where(eq(locks.id, id))
        .returning();

      if (!finalResult[0]) {
        throw new Error('Lock not found after milestone update');
      }
      return { lock: finalResult[0], milestoneReached };
    }

    return { lock: updatedLock, milestoneReached: null };
  }

  async getLastLock(): Promise<Lock | null> {
    const result = await this.db.select().from(locks).orderBy(desc(locks.id)).limit(1);
    return result[0] ?? null;
  }
}
