# Memory Locks API - Project Documentation

## Project Overview
This project is the backend API for **Memory Locks**, an edge-native application built on **Cloudflare Workers**. It provides services for user authentication, media management (images/videos), and digital locking mechanisms.

## Tech Stack
- **Runtime**: Cloudflare Workers
- **Framework**: Hono (v4+)
- **Language**: TypeScript
- **Data & Storage**:
    -   **Relational**: D1 (SQLite) with Drizzle ORM
    -   **Media**: Cloudflare Images & Streams
    -   **Key-Value**: Cloudflare KV (Idempotency)
- **External Services**: Twilio (Auth), SightEngine (Content Moderation), RevenueCat (Subscriptions), Apple/Google Auth.
- **Testing**: Vitest

## Architecture
The project follows a **Clean / Layered Architecture**:

1.  **Presentation Layer** (`src/presentation`)
    -   **Routes**: Hono route definitions (`.route()`).
    -   **Controllers**: Logic inside route handlers handles HTTP request parsing, validation (Zod), and response formatting.
    -   **Middleware**: Auth, Logging, Idempotency.
    -   **Context**: Uses `ServiceContainer` injected via Hono context.

2.  **Service Layer** (`src/services`)
    -   Contains business logic.
    -   **Pattern**: Returns `ServiceResult<T>` instead of throwing exceptions for expected business errors.
    -   **Input**: Strongly typed DTOs.
    -   **Output**: `ServiceResult` containing data or error details.

3.  **Data Layer** (`src/data`)
    -   **Repositories**: Encapsulate Drizzle queries.
    -   **Schema**: Drizzle schema definitions.
    -   **Mappers**: Transform DB rows to Domain/DTO objects.

4.  **Infrastructure** (`src/infrastructure`)
    -   Implementations of external clients (Twilio, SMTP, etc.).

## Coding Conventions

### Naming
-   **Files**: `kebab-case` (e.g., `user-service.ts`).
-   **Classes/Interfaces**: `PascalCase` (e.g., `UserService`, `UserProfile`).
-   **Variables/Functions**: `camelCase`.

### Error Handling
-   **Do not throw errors** for business logic failures (e.g., "User not found").
-   Use the `ServiceResult` pattern:
    ```typescript
    if (error) {
      return failure("ERROR_CODE", "Human readable message", details, httpStatusCode);
    }
    return success(data);
    ```

### Database
-   Use **Drizzle ORM**.
-   Prefer atomic updates using `db.batch()` where possible.
-   Use Repositories for all DB access; avoid calling `db` directly in Services if a Repository exists.

### Dependency Injection
-   Services and Repositories are manually wired in `src/index.ts` and exposed via `ServiceContainer`.
-   Access services in routes via `getService(c).services.contextName.method()`.

## Directory Structure
```
src/
├── common/           # Shared utilities, logging, result pattern
├── config/           # Environment configuration
├── data/             # Drizzle schema, migrations, repositories
├── infrastructure/   # External API clients
├── presentation/     # Hono routes, middleware, HTTP utilities
├── services/         # Business logic services and DTOs
└── index.ts          # Application entry point & DI wiring
```
