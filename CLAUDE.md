# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memory Locks API (ML-API) is a Cloudflare Workers-based edge-native API for managing Memory Locks - physical products with QR codes that unlock photo/video albums. Built with Hono framework, TypeScript, Cloudflare D1 (SQLite), KV (Key value pair database) and Images/Stream (media database).

## Key Commands

### Development
```bash
  npm run dev             # Local development with Wrangler
  npm run build           # Dry-run deploy to validate build
  npm run lint            # TypeScript type checking (no emit)
  npm test                # Run Vitest tests
  npm run test:watch      # Watch mode for tests
```

### Deployment
Deployment is automated via GitHub Actions. Push to `main` branch to trigger automatic deployment to Cloudflare Workers. Do not use `npm run deploy` directly - let CI/CD handle deployments.

### Database Migrations
```bash
  wrangler d1 execute DB --remote --file=./db/migrations/XXX_migration_name.sql
```

### Secrets Management
Secrets are managed via Wrangler CLI, not in code:
```bash
  wrangler secret put SECRET_NAME
  wrangler secret list
```

## Architecture

### Layered Architecture (Clean Architecture-inspired)

**Presentation Layer** (`src/presentation/`): HTTP handling, routing, validation
- Routes defined in `src/presentation/routes/`
- Hono context helpers in `src/presentation/http/context.ts`
- Middleware (auth, logging, idempotency) in `src/presentation/http/middleware.ts`
- Response patterns in `src/presentation/http/responses.ts`

**Business Layer** (`src/business/`): Domain logic and services
- Services coordinate business operations (e.g., `LockService`, `UserAuthFlowService`)
- DTOs in `src/business/dtos/`
- Business constants (like milestones) in `src/business/constants/`

**Data Layer** (`src/data/`): Database access using Drizzle ORM
- Repositories handle all database queries
- Mappers convert between database rows and domain models
- Schema definitions in `src/data/schema/`
- Transaction wrapper in `src/data/transaction.ts`

**Infrastructure Layer** (`src/infrastructure/`): External service integrations
- Twilio, Firebase, Cloudflare, Sightengine, Apple/Google OAuth
- JWT service, image compression, cache invalidation

**Common** (`src/common/`): Shared utilities
- Result types (`ServiceResult<T>`) for error handling
- Logger, HashIds, idempotency helpers
- Context creation and dependency injection

### Dependency Injection via ServiceContainer

All services, repositories, and infrastructure clients are wired together in `src/common/context.ts` via the `createRequestContext` function. This creates a `ServiceContainer` that is attached to each request via Hono middleware and accessed via `getContainer(c)` in routes.

The container pattern ensures:
- All dependencies are initialized once per request
- Configuration is loaded and validated early
- Easy to mock for testing
- Type-safe access to all services

### Result Pattern

Services return `ServiceResult<T>` types (see `src/common/result.ts`):
- `ServiceSuccess<T>`: `{ ok: true, data: T, message?, status? }`
- `ServiceFailure`: `{ ok: false, error: { code, message, details }, status? }`

Use `respondFromService` helper in routes to convert ServiceResult to HTTP responses.

### Dual-Domain Setup

This worker handles TWO domains with different behaviors:
- `api.memorylocks.com/*`: API endpoints (routes in `/locks`, `/users`, etc.)
- `album.memorylocks.com/*`: Web album viewer (static HTML + server-side data injection)

Routes are defined in `wrangler.toml` and handled in `src/index.ts`. The web album routes (`src/presentation/routes/web-album.ts`) serve static assets from the `web-album/` directory using Workers Assets binding.

### HashIds for External IDs

Numeric database IDs are never exposed externally. All lock IDs in API responses and URLs are hashed using HashIds (`src/common/hashids.ts`). This provides:
- Obfuscation of internal IDs
- Short, URL-safe identifiers
- Deterministic encoding/decoding

### Idempotency

The API supports idempotency via `Create-Lock-Key` header for critical operations (e.g., lock creation, media uploads). Implemented in:
- `src/infrastructure/idempotency.ts`: Core logic using KV namespace
- `src/presentation/http/middleware.ts`: `idempotencyMiddleware` wrapper
- Applied per-route basis on mutation endpoints

### Authentication

Three auth flows supported:
1. **Phone OTP** (Twilio Verify): Sends SMS code, verifies, issues JWT
2. **Apple Sign-In**: Validates Apple identity token, links to user
3. **Google OAuth**: Validates Google identity token, links to user

Implemented in `UserAuthFlowService` (`src/business/services/user-auth-flow-service.ts`). JWT tokens are issued via `SessionTokenService` with access/refresh token pattern.

Routes use `jwt()` middleware from Hono for protected endpoints, then `setUserContext` middleware extracts user ID into Hono context.

### Media Storage & Cleanup

Media (images/videos) stored in Cloudflare Images/Stream:
- Upload flow: `ManageMediaService.handleMediaUpload` validates, compresses (via Sightengine), uploads to Cloudflare
- Deletion: Creates `cloudflare_cleanup_jobs` records for async retry
- Cron job (`src/jobs/process-cleanup-jobs.ts`) runs every 12 hours to process pending deletions with exponential backoff

### Caching & Invalidation

Web albums cached at Cloudflare edge for 24 hours. Cache purging:
- `src/infrastructure/cloudflare-purge.ts`: Calls Cloudflare API to purge by URL
- `src/infrastructure/cache-invalidation.ts`: Helper to invalidate album cache
- Called after metadata changes, media uploads, lock name updates

### Scan Tracking with Edge Bypass

Album scans tracked via `/scan-beacon` endpoint:
- Lightweight GET request with `no-cache` headers (bypasses edge cache)
- Uses `ctx.waitUntil()` to increment counter asynchronously
- `ScanCounterService` handles milestone notifications (50, 100, 500, 1000 scans)

## Configuration

Configuration loaded from environment variables in `src/config/env.ts`. Required secrets:
- `JWT_SECRET`: For signing access/refresh tokens
- `CREATE_LOCK_API_KEY`: API key for lock creation endpoint (used by manufacturing)
- `PUSH_NOTIFICATION_KEY`: API key for push notification routes
- `HASHIDS_SALT`: Salt for HashIds encoding

Optional secrets enable features:
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- Cloudflare Media: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_UPLOAD_TOKEN`
- Cloudflare Purge: `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_TOKEN`
- Firebase: `FIREBASE_SERVICE_ACCOUNT_JSON`
- Apple OAuth: `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_AUTH_KEY_PEM`
- Google OAuth: `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`

## Database

Cloudflare D1 (SQLite) with Drizzle ORM. Schema is in `db/schema.sql` with migrations in `db/migrations/`.

Key tables:
- `users`: User accounts with auth provider info
- `locks`: Memory lock products (1:1 with physical QR codes)
- `media_objects`: Photos/videos in locks (foreign key to locks)
- `cloudflare_cleanup_jobs`: Pending Cloudflare media deletions

**Important**: `display_order` in `media_objects` intentionally allows gaps/duplicates. The mobile app treats collection index as source of truth and rebuilds all display_order values on publish.

Each lock can only have one `is_main_picture = TRUE` enforced by unique partial index.

## Testing

Tests use Vitest. Currently no test files in repo - when adding tests, place in `tests/` directory.

## Edge Cases & Quirks

1. **Album caching**: Web albums are cached for 24 hours at edge. Always invalidate cache after metadata changes via `invalidateAlbumCache()`.

2. **Cron schedule mismatch**: `wrangler.toml` defines cron as `0 */12 * * *` but `src/index.ts` checks for `*/15 * * * *`. Update code to match config.

3. **Storage limits**: Tiered storage limits defined in `src/config/env.ts` storageLimits. Tier 1: 50 images + 60s video. Tier 2: 100 images + 120s video.

4. **Media object deletion**: Never delete media_objects directly - always use `ManageMediaService` to create cleanup jobs for Cloudflare resources.

5. **HashIds are NOT UUIDs**: They're deterministic encodings of numeric IDs. Same ID always produces same hash. Use `hashids.encode(id)` and `hashids.decode(hash)`.
