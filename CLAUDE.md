# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ML-API is a unified edge-native API for Memory Locks built with Hono and deployed on Cloudflare Workers. It replaces the legacy ASP.NET Core API and database worker, consolidating authentication, lock management, media handling, album operations, and notifications into a single Worker running on Cloudflare's edge network.

## Development Commands

```bash
# Development
npm run dev              # Start local dev server with wrangler dev --local
npm run build           # Create deployable bundle (dry run)
npm run deploy          # Deploy to Cloudflare

# Quality assurance
npm run test            # Run Vitest suite
npm run test:watch      # Run Vitest in watch mode
npm run lint            # Type-check with TypeScript (tsc --noEmit)
```

## Architecture

The codebase follows a strict three-tier architecture:

### 1. Presentation Layer (`src/presentation/`)
- **Routes** (`routes/`): Hono route registries for each domain (users, locks, media-objects, albums, push-notifications)
- **HTTP utilities** (`http/`): Response helpers, validation, middleware, error handling
- Thin layer that delegates to business services and returns standardized JSON envelopes

### 2. Business Layer (`src/business/`)
- **Services** (`services/`): Domain services containing all application logic
  - `UserAuthFlowService`: Authentication, OAuth (Apple/Google), phone verification
  - `UserService`: User management operations
  - `LockService`: Lock provisioning, unlocking, metadata changes
  - `ViewAlbumService`: Album CRUD and media attachment
  - `ManageMediaService`: Media upload, moderation, Cloudflare Images/Stream
  - `NotificationService`: FCM push notifications
- **DTOs** (`dtos/`): Request/response contracts in PascalCase (API format)
- **Errors** (`errors.ts`): Domain-specific error classes (NotFoundError, ValidationError, etc.)

### 3. Data Layer (`src/data/`)
- **Repositories** (`repositories/`): D1 database access (UserRepository, LockRepository, MediaObjectRepository)
- **Models** (`models/`): D1 row representations (snake_case)
- **Mappers** (`mappers/`): Transform between snake_case DB models and PascalCase DTOs

### Cross-Cutting Concerns

**Infrastructure** (`src/infrastructure/`): External integrations using Web-standard fetch
- `twilio.ts`: Twilio Verify for phone verification
- `firebase.ts`: FCM push notifications
- `cloudflare.ts`: Cloudflare Images and Stream API
- `sightengine.ts`: Content moderation
- `oauth-apple.ts`, `oauth-google.ts`: OAuth token verification
- `jwt.ts`: JWT signing and validation

**Common** (`src/common/`):
- `context.ts`: Per-request dependency injection container
- `result.ts`: ServiceResult<T> discriminated union for service responses
- `hashids.ts`: Lock identifier encoding/decoding
- `logger.ts`: Request-scoped logging interface
- `bindings.ts`: Cloudflare Worker environment bindings types

## Request Lifecycle

1. Hono middleware in `src/index.ts` creates a `ServiceContainer` for each request via `createRequestContext()`
2. The container is stored in Hono context variables (`c.set("container", container)`)
3. Route handlers extract the container and delegate to business services
4. Services orchestrate repositories and infrastructure clients, returning `ServiceResult<T>`
5. Controllers convert results to the Memory Locks JSON envelope: `{ Success, Message, Data }`
6. Domain errors (from `business/errors.ts`) are caught by `handleError()` and mapped to HTTP status codes

## Key Design Patterns

### Per-Request Dependency Injection
All repositories and services are instantiated per-request in `createRequestContext()` (src/common/context.ts). This eliminates global mutable state and enables request-scoped logging.

### ServiceResult Pattern
Services return `ServiceResult<T>` (src/common/result.ts) instead of throwing exceptions for expected failures:
```typescript
const result = await service.doSomething();
if (!result.ok) {
  return c.json({ Success: false, Message: result.error.message }, result.status);
}
return c.json({ Success: true, Data: result.data }, 200);
```

### DTOs vs Models
- **DTOs** (business/dtos/): PascalCase, used in API requests/responses
- **Models** (data/models/): snake_case, match D1 schema
- **Mappers** (data/mappers/): Transform between the two representations

### Response Envelope
All endpoints return a consistent JSON structure:
```typescript
{
  Success: boolean,
  Message?: string,
  Data?: T,
  Code?: string  // Only on errors
}
```

## Configuration & Bindings

Configuration is loaded from Cloudflare Worker bindings via `loadConfig()` in `src/config/env.ts`.

**Critical bindings** (set in wrangler.toml):
- `DB`: Cloudflare D1 database instance
- `CREATE_LOCK_API_KEY`: Secret for bulk lock provisioning endpoint (header: `Create-Lock-Key`)
- `HASHIDS_SALT`, `HASHIDS_MIN_LENGTH`: Lock ID obfuscation
- Twilio credentials: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- Cloudflare media: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_UPLOAD_TOKEN`
- Firebase: `FIREBASE_SERVICE_ACCOUNT_JSON`
- JWT: `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_SECRET`
- Apple OAuth: `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_AUTH_KEY_PEM`
- Google OAuth: `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`
- Sightengine: `SIGHTENGINE_USER`, `SIGHTENGINE_SECRET`

Update `wrangler.toml` with real credentials before deploying.

## Adding New Features

1. **Data layer**: Create repository methods if new DB queries needed
2. **Business layer**: Implement service methods with business logic, return `ServiceResult<T>`
3. **Presentation layer**: Add route handler that calls service and converts result to JSON envelope
4. **Types**: Add DTOs for request/response contracts, mappers for DB transformations

Services are auto-wired in `createRequestContext()` when needed by routes.

## Testing

Tests use Vitest and should mirror the API surface. Currently scaffolded but not fully implemented. When writing tests:
- Mock dependencies by injecting test implementations into services
- Use `ServiceResult` pattern for assertions
- Test both success and failure paths

## Additional Notes

- The Worker uses `wrangler dev --local` for development with a local D1 instance
- CORS is configured for `http://localhost:3000` and `https://album.memorylocks.com`
- Rate limiting middleware exists in `presentation/http/middleware.ts`
- All external HTTP calls use native `fetch` (no Node.js polyfills)
- Cryptographic operations use WebCrypto APIs (JOSE library for JWT/JWK)

See `docs/ARCHITECTURE.md` for detailed architectural documentation.
