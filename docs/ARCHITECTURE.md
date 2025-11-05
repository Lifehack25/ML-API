# ML-API Architecture

This document captures the target structure for the **ML-API** Cloudflare Worker that consolidates the existing ASP.NET Core API and the legacy database worker into a single, edge-native service powered by [Hono](https://hono.dev/).

The project is organised around a clean three-tier architecture:

1. **Presentation Layer** – HTTP endpoints (routes/controllers) implemented with Hono.
2. **Business Layer** – Use-case oriented services that contain all application logic.
3. **Data Layer** – Repository abstractions over Cloudflare D1, plus data mappers/models.

Cross-cutting concerns (authentication, rate limiting, external integrations) live in the **infrastructure** and **common** modules and are injected into services through lightweight context factories.

---

## Project Layout

```
ML-API/
 ├── src/
 │   ├── app.ts                  # Hono application bootstrap
 │   ├── presentation/           # Presentation layer
 │   │   ├── http/               # Response helpers, middleware glue
 │   │   ├── routes/             # Route registries (users, locks, media, albums, notifications)
 │   │   └── controllers/        # Thin handlers delegating to business services
 │   ├── business/               # Business layer
 │   │   ├── dtos/               # Request/response DTO contracts
 │   │   ├── services/           # Domain services (Auth, User, Lock, Media, Notification, Album)
 │   │   └── errors.ts           # Domain errors propagated to presentation layer
 │   ├── data/                   # Data layer
 │   │   ├── models/             # D1 row representations
 │   │   ├── mappers/            # Maps between models and DTOs (PascalCase ↔ snake_case)
 │   │   └── repositories/       # D1 repositories (UserRepo, LockRepo, MediaRepo)
 │   ├── infrastructure/         # External integrations
 │   │   ├── cloudflare.ts       # Cloudflare Images/Stream client
 │   │   ├── firebase.ts         # FCM push helper
 │   │   ├── jwt.ts              # JWT signing/validation utilities
 │   │   ├── sightengine.ts      # Content moderation client
 │   │   ├── twilio.ts           # Twilio Verify REST client
 │   │   ├── oauth-apple.ts      # Apple token verifier (via JOSE + JWKS cache)
 │   │   └── oauth-google.ts     # Google ID token verifier
 │   ├── common/                 # Shared helpers
 │   │   ├── bindings.ts         # Worker env/bindings types
 │   │   ├── context.ts          # Per-request composition root (repositories + services)
 │   │   ├── hashids.ts          # Hashids encode/decode helpers
 │   │   ├── logger.ts           # Console-based logger interface
 │   │   ├── rateLimit.ts        # Sliding-window rate limiter middleware
 │   │   └── result.ts           # `ServiceResult<T>` discriminated union
 │   └── config/env.ts           # Typed configuration loader (reads from bindings)
 ├── package.json
 ├── tsconfig.json
 ├── wrangler.toml
 ├── README.md
 └── tests/                      # Vitest suite mirroring API surface
```

---

## Request Lifecycle

1. **Hono route** receives the request and resolves a `RequestContext` (repositories, services, logger, env).
2. The route delegates to a **controller function** that performs minimal validation and calls a domain **service**.
3. The service orchestrates repository operations and infrastructure integrations, returning a typed `ServiceResult`.
4. The controller converts the `ServiceResult` into the JSON envelope used throughout the Memory Locks ecosystem:
   ```json
   { "success": true, "message": "...", "data": { ... } }
   ```
5. Errors propagate through domain-specific exceptions (e.g., `NotFoundError`, `ValidationError`) and are translated into HTTP status codes by a shared error handler.

---

## Key Design Decisions

- **One Worker, Many Services**  
  The Worker exposes the union of endpoints previously split between the ASP.NET API and the database worker. Authentication routes mirror the concise style of the .NET controllers while data-centric routes reuse the proven repository logic from the worker.

- **Per-Request Dependency Composition**  
  To avoid global mutable state, repositories and services are created per request via `createRequestContext(c)`. This enables request-scoped logging and makes it easy to inject mock implementations in tests.

- **Edge-Friendly Integrations**  
  External providers (Twilio, Sightengine, Cloudflare Images/Stream, Firebase, Apple, Google) are accessed with Web-standard `fetch` and WebCrypto-based JOSE helpers so that the worker runs without Node.js polyfills.

- **Consistent DTOs**  
  DTOs follow the PascalCase layout exposed by the original API, while repository models retain snake_case columns. Mappers ensure a single source of truth for transformations, and string enums (e.g., metadata change types) keep wire payloads self-describing.

- **Rate Limiting & Secrets**  
  Sliding-window rate limiting lives in `presentation/http/middleware.ts`, and the only API-key protected surface is the lock provisioning endpoint that expects `CREATE_LOCK_API_KEY`.

- **Extensibility**  
  New features can be added by introducing a service (business layer), repositories if needed (data layer), and a route/controller (presentation layer), without leaking concerns.

---

## Bindings Overview

The Worker expects the following bindings (provisioned via `wrangler.toml`):

| Binding | Description |
|---------|-------------|
| `DB` | Cloudflare D1 database |
| `CREATE_LOCK_API_KEY` | Secret used exclusively for bulk lock provisioning (sent via `Create-Lock-Key` header) |
| `HASHIDS_SALT` / `HASHIDS_MIN_LENGTH` | Hashid configuration for lock identifiers |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify credentials |
| `SIGHTENGINE_USER` / `SIGHTENGINE_SECRET` | Sightengine moderation credentials |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_UPLOAD_TOKEN` | Cloudflare media API credentials |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Google service account JSON for FCM |
| `JWT_ISSUER` / `JWT_AUDIENCE` / `JWT_SECRET` | JWT configuration |
| `APPLE_BUNDLE_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_AUTH_KEY_PEM` | Apple Sign-In configuration |
| `GOOGLE_ANDROID_CLIENT_ID` / `GOOGLE_IOS_CLIENT_ID` | Google Sign-In OAuth client IDs |


---

## Next Steps

1. Scaffold the project files (`package.json`, `tsconfig.json`, `wrangler.toml`).
2. Implement the shared `RequestContext` factory and repositories.
3. Port business logic from the .NET use cases into TypeScript services.
4. Wire up Hono routes with concise handlers mirroring the original controller surface.
5. Backfill Vitest coverage for critical flows (auth, locks, albums, media uploads).

This structure provides a maintainable foundation for deploying the unified Memory Locks API directly on Cloudflare’s edge.
