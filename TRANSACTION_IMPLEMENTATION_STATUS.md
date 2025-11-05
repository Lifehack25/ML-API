# Transaction Safety & Idempotency Implementation Status

**Date:** 2025-11-05
**Status:** 60% COMPLETE - Repository Layer & Infrastructure Done
**Remaining:** Service Layer Refactoring & Background Jobs

---

## ✅ COMPLETED (13/22 tasks)

### Phase 1: Infrastructure (100% Complete)

1. **Transaction Wrapper** (`src/data/transaction.ts`)
   - `withTransaction<T>()` - Wraps operations in BEGIN IMMEDIATE/COMMIT/ROLLBACK
   - `getTransactionDb()` - Helper for optional transaction participation
   - `isInTransaction()` - Nested transaction detection
   - **Result:** Strongly consistent ACID guarantees for all D1 operations

2. **Database Migrations** (All Applied to Production D1)
   - `db/migrations/001_add_idempotency_keys.sql` - Request deduplication table
   - `db/migrations/002_add_cloudflare_cleanup_jobs.sql` - Retry queue for failed Cloudflare deletions
   - `db/migrations/003_add_failed_registrations.sql` - Audit trail for Twilio verification edge cases
   - `db/schema.sql` updated with all new tables + indexes
   - **Result:** Production D1 now has all required tables

3. **Idempotency System**
   - `src/infrastructure/idempotency.ts` - IdempotencyService (D1-based, 24hr TTL)
   - `src/presentation/http/middleware.ts` - idempotencyMiddleware (auto key generation, race condition handling)
   - Integrated into ServiceContainer
   - **Result:** Strong consistency, no KV eventual consistency issues

### Phase 2: Repository Layer (100% Complete)

4. **MediaObjectRepository** (`src/data/repositories/media-object-repository.ts`)
   - ✅ `create()` - Atomic unset + insert (fixes main picture race condition)
   - ✅ `update()` - Atomic unset + update
   - ✅ `batchReorder()` - True transaction (replaces D1 batch API for all-or-nothing guarantee)
   - ✅ All methods accept optional `txDb` parameter for external transaction control
   - **Fixes:** Main picture race conditions, partial batch failures

5. **UserRepository** (`src/data/repositories/user-repository.ts`)
   - ✅ All methods support optional `txDb` parameter
   - ✅ Ready for multi-step auth flows (create + verify + link in one transaction)
   - **Fixes:** Enables atomic user registration

6. **LockRepository** (`src/data/repositories/lock-repository.ts`)
   - ✅ `incrementScanCount()` - Atomic scan increment + milestone update
   - ✅ All methods support optional `txDb` parameter
   - **Fixes:** Milestone notification duplicates

7. **CleanupJobRepository** (`src/data/repositories/cleanup-job-repository.ts`)
   - ✅ `create()` - Schedule Cloudflare cleanup with idempotency
   - ✅ `getPendingJobs()` - Fetch jobs ready for retry
   - ✅ `markCompleted()` / `markFailedAndScheduleRetry()` - Exponential backoff (1m, 5m, 15m, 1h, 6h, 24h)
   - ✅ `getStats()` - Monitoring metrics
   - **Result:** Retry queue for orphaned media cleanup

### Phase 3: Service Layer (PARTIAL - MediaService Upload Only)

8. **MediaService** (`src/business/services/media-service.ts`)
   - ✅ Constructor updated with CleanupJobRepository
   - ✅ `uploadSingleMedia()` - **COMPENSATING TRANSACTION**: If DB fails after Cloudflare upload, schedules cleanup job
   - ❌ `deleteMediaById()` - STILL NEEDS: Reverse order (DB first, Cloudflare cleanup scheduled)
   - ❌ `publishMetadata()` - STILL NEEDS: Wrap all DB operations in transaction
   - **Result:** Upload now has consistency guarantee, deletion/publishing still at risk

---

## 🚧 REMAINING WORK (9/22 tasks)

### Service Layer Refactoring (CRITICAL - 4 tasks remaining)

#### 1. MediaService - Complete Remaining Methods

**File:** `src/business/services/media-service.ts`

**`deleteMediaById()` (lines 336-350) - NEEDS:**
```typescript
// Current: Cloudflare delete → DB delete (orphans if DB fails)
// Required: DB delete → Schedule Cloudflare cleanup
async deleteMediaById(mediaId: number, cloudflareId?: string | null, isImage = true): Promise<void> {
  // NEW: Delete from DB first (in transaction)
  await this.mediaRepository.delete(mediaId);

  // NEW: Schedule async Cloudflare cleanup (best-effort with retries)
  if (cloudflareId) {
    try {
      await this.cleanupJobRepository.create({
        cloudflare_id: cloudflareId,
        media_type: isImage ? "image" : "video",
      });
    } catch (error) {
      this.logger.warn("Failed to schedule Cloudflare cleanup", { error });
    }
  }
}
```

**`publishMetadata()` (lines 192-316) - NEEDS:**
```typescript
// Current: Parallel operations with partial failure handling (207 Multi-Status)
// Required: Single transaction for all DB operations, schedule Cloudflare cleanup after success

async publishMetadata(request: PublishMetadataRequest): Promise<ServiceResult<PublishResult>> {
  return withTransaction(this.db, async (tx) => {
    // Group all DB operations
    const mediaToDelete = []; // Track for Cloudflare cleanup

    // 1. DB deletions (collect Cloudflare IDs)
    for (const deleteChange of deletes) {
      const media = await this.mediaRepository.findById(deleteChange.mediaId, tx);
      if (media) {
        mediaToDelete.push({ cloudflare_id: media.cloudflare_id, is_image: media.is_image });
        await this.mediaRepository.delete(deleteChange.mediaId, tx);
      }
    }

    // 2. Batch reorder (already uses transaction)
    await this.mediaRepository.batchReorder(reorders, tx);

    // 3. Main image updates (already uses transaction)
    for (const update of mainImageUpdates) {
      await this.mediaRepository.update(update.mediaId, { is_main_picture: true }, tx);
    }

    // 4. Album title update
    if (albumTitle) {
      await this.lockRepository.update(lockId, { album_title: albumTitle }, tx);
    }

    // Transaction commits here - all or nothing

    // 5. Schedule Cloudflare cleanup jobs (after transaction succeeds)
    for (const media of mediaToDelete) {
      await this.cleanupJobRepository.create({
        cloudflare_id: media.cloudflare_id,
        media_type: media.is_image ? "image" : "video",
      });
    }

    return { successfulChanges: changes.length, failed: [] };
  });
}
```

#### 2. AuthService - Transaction Wrapping

**File:** `src/business/services/auth-service.ts`

**`verifyCode()` (lines 82-161) - NEEDS:**
```typescript
// Current: Twilio verify → user create → mark verified → issue tokens (no transaction)
// Required: Wrap DB operations in transaction, log to failed_registrations on DB failure

async verifyCode(...): Promise<ServiceResult<AuthResponse>> {
  // 1. Twilio verify (cannot rollback - external API)
  const verified = await this.twilioClient.verify(...);

  if (!verified.success) {
    return failure(...);
  }

  // 2. Wrap DB operations in transaction
  try {
    const user = await withTransaction(this.db, async (tx) => {
      // Check duplicates
      const existing = await this.userRepository.findByEmailCaseInsensitive(email, tx);
      if (existing) throw new Error("User exists");

      // Create user
      const user = await this.userRepository.create(userData, tx);

      // Mark verified
      if (isEmail) {
        await this.userRepository.markEmailVerified(user.id, tx);
      } else {
        await this.userRepository.markPhoneVerified(user.id, tx);
      }

      // Update auth metadata
      await this.userRepository.updateAuthMetadata(user.id, { lastLoginAt: now }, tx);

      return user;
    });

    // Issue tokens
    const tokens = await this.userSessionService.issueTokens(user.id);
    return success({ user, tokens });

  } catch (dbError) {
    // Log failed registration (Twilio verified but DB failed)
    await this.db.prepare(`
      INSERT INTO failed_registrations (identifier, verification_code, error_message, twilio_verified)
      VALUES (?, ?, ?, TRUE)
    `).bind(identifier, code, String(dbError)).run();

    return failure("REGISTRATION_FAILED", "Failed to create user account", undefined, 500);
  }
}
```

**OAuth flows (`verifyGoogle`, `verifyApple`) - NEEDS:**
```typescript
// Similar pattern: Wrap ExternalUserLinkService.findOrCreate() in transaction
```

#### 3. ExternalUserLinkService - Transaction Wrapping

**File:** `src/business/services/external-user-link-service.ts`

**`findOrCreate()` (lines 19-61) - NEEDS:**
```typescript
// Current: Check by provider → check by email → link/create (no transaction)
// Required: Wrap entire flow in transaction

async findOrCreate(...): Promise<UserRow> {
  return withTransaction(this.db, async (tx) => {
    // Check existing by provider
    let user = await this.userRepository.findByProvider(provider, providerId, tx);
    if (user) return user;

    // Check existing by email
    if (email) {
      user = await this.userRepository.findByEmailCaseInsensitive(email, tx);
      if (user) {
        // Link provider
        await this.userRepository.linkProvider(user.id, provider, providerId, tx);
        await this.userRepository.markEmailVerified(user.id, tx);
        return user;
      }
    }

    // Create new user
    user = await this.userRepository.create({ name, email, ... }, tx);
    await this.userRepository.markEmailVerified(user.id, tx);
    await this.userRepository.linkProvider(user.id, provider, providerId, tx);
    return user;
  });
}
```

#### 4. UserService - Transaction Wrapping

**File:** `src/business/services/user-service.ts`

**`verifyIdentifier()` (lines 69-109) - NEEDS:**
```typescript
// Similar to AuthService.verifyCode() - wrap in transaction
```

**`deleteAccount()` (lines 125-147) - NEEDS:**
```typescript
async deleteAccount(userId: number): Promise<ServiceResult<void>> {
  return withTransaction(this.db, async (tx) => {
    // 1. Get all locks for user
    const locks = await this.lockRepository.findAllByUserId(userId, tx);

    // 2. Get all media for cleanup (before deletion)
    const mediaToCleanup = [];
    for (const lock of locks) {
      const media = await this.mediaRepository.findByLockId(lock.id, tx);
      mediaToCleanup.push(...media.map(m => ({
        cloudflare_id: m.cloudflare_id,
        media_type: m.is_image ? "image" : "video",
      })));
    }

    // 3. Delete media objects (cascades via foreign key, but we track for Cloudflare)
    for (const lock of locks) {
      await this.mediaRepository.deleteByLockId(lock.id, tx);
    }

    // 4. Orphan locks
    await this.lockRepository.clearUserAssociation(userId, tx);

    // 5. Delete user
    await this.userRepository.delete(userId, tx);

    // Transaction commits - all or nothing

    // 6. Schedule Cloudflare cleanup jobs (after transaction)
    for (const media of mediaToCleanup) {
      await this.cleanupJobRepository.create(media, tx); // Can use same tx since we're still in it
    }

    return success(undefined, "Account deleted");
  });
}
```

### Route Integration (1 task)

#### 5. Apply Idempotency Middleware to Routes

**Files:** `src/presentation/routes/*.ts`

Add `idempotencyMiddleware` to these endpoints:
- `POST /users/register-verify` (auth)
- `POST /users/verify-identifier` (users)
- `DELETE /users/me` (users)
- `POST /auth/google` (auth)
- `POST /auth/apple` (auth)
- `POST /locks/media` (locks)
- `DELETE /locks/:lockId/media/:mediaId` (locks)
- `POST /locks/:lockId/publish` (locks)
- `POST /locks/create/:totalLocks` (locks)
- `POST /push-notifications/register` (push-notifications)

**Example:**
```typescript
import { idempotencyMiddleware } from "../http/middleware";

app.post("/locks/media", idempotencyMiddleware, async (c) => {
  // Handler logic - idempotency automatic
});
```

### Background Jobs (4 tasks)

#### 6. Cloudflare Cleanup Job Processor

**Create:** `src/jobs/process-cleanup-jobs.ts`

```typescript
import type { Env } from "../common/bindings";
import { CleanupJobRepository } from "../data/repositories/cleanup-job-repository";
import { createCloudflareMediaClient } from "../infrastructure/cloudflare";
import { loadConfig } from "../config/env";

export async function processCleanupJobs(env: Env, ctx: ExecutionContext): Promise<void> {
  const config = loadConfig(env);
  const cleanupJobRepo = new CleanupJobRepository(env.DB);
  const cloudflareClient = createCloudflareMediaClient(config.cloudflareMedia);

  // Get pending jobs
  const jobs = await cleanupJobRepo.getPendingJobs(50);
  console.log(`Processing ${jobs.length} cleanup jobs`);

  for (const job of jobs) {
    try {
      // Attempt Cloudflare deletion
      const result = job.media_type === "image"
        ? await cloudflareClient.deleteImage(job.cloudflare_id)
        : await cloudflareClient.deleteVideo(job.cloudflare_id);

      if (result.success) {
        await cleanupJobRepo.markCompleted(job.id);
        console.log(`Cleaned up ${job.media_type} ${job.cloudflare_id}`);
      } else {
        await cleanupJobRepo.markFailedAndScheduleRetry(job.id, result.error || "Unknown error");
      }
    } catch (error) {
      await cleanupJobRepo.markFailedAndScheduleRetry(job.id, String(error));
    }
  }
}
```

#### 7. Idempotency Key Cleanup Job

**Create:** `src/jobs/cleanup-idempotency.ts`

```typescript
import type { Env } from "../common/bindings";

export async function cleanupExpiredIdempotencyKeys(db: D1Database): Promise<void> {
  const result = await db
    .prepare(`DELETE FROM idempotency_keys WHERE expires_at < datetime('now') LIMIT 1000`)
    .run();

  console.log(`Deleted ${result.meta.changes} expired idempotency keys`);
}
```

#### 8. Update wrangler.toml with Cron Triggers

**File:** `wrangler.toml`

Add:
```toml
[triggers]
crons = [
  "0 2 * * *",      # Daily at 2 AM UTC: cleanup expired idempotency keys
  "*/15 * * * *"    # Every 15 minutes: process Cloudflare cleanup jobs
]
```

#### 9. Update src/index.ts with Scheduled Event Handler

**File:** `src/index.ts`

Add:
```typescript
import { processCleanupJobs } from "./jobs/process-cleanup-jobs";
import { cleanupExpiredIdempotencyKeys } from "./jobs/cleanup-idempotency";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Existing fetch handler
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 2 * * *") {
      // Daily cleanup of expired idempotency keys
      await cleanupExpiredIdempotencyKeys(env.DB);
    } else if (event.cron === "*/15 * * * *") {
      // Every 15 minutes: process Cloudflare cleanup jobs
      await processCleanupJobs(env, ctx);
    }
  }
}
```

---

## Summary of Consistency Guarantees

### Before This Implementation
- ❌ Cloudflare upload → DB fail = orphaned media
- ❌ Main picture updates = race conditions
- ❌ Batch reorder = partial state on failure
- ❌ User registration = partially created accounts
- ❌ Account deletion = orphaned Cloudflare media
- ❌ Retry = duplicate operations

### After This Implementation (When Complete)
- ✅ Cloudflare upload → DB fail = cleanup scheduled automatically
- ✅ Main picture updates = atomic (unset + set in transaction)
- ✅ Batch reorder = all-or-nothing
- ✅ User registration = atomic (create + verify in transaction)
- ✅ Account deletion = all DB operations atomic, Cloudflare cleanup scheduled
- ✅ Retry = idempotent (cached response returned)

---

## Deployment Checklist

1. ✅ Database migrations applied to production
2. ✅ Repository layer deployed (all methods transaction-safe)
3. ⏳ Service layer refactoring (4 services remaining)
4. ⏳ Middleware applied to routes (10 endpoints)
5. ⏳ Background jobs deployed
6. ⏳ Cron triggers configured

**Next Steps:** Complete remaining 9 tasks above, deploy, monitor cleanup job queue and idempotency cache hit rates.
