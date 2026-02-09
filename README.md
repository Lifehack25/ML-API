# Memory Locks API (ml-api)

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)

**Memory Locks API** is the edge-native backend service for the Memory Locks application, built on [Cloudflare Workers](https://workers.cloudflare.com/) and [Hono](https://hono.dev/). It handles user authentication, media management (images/video), and digital "locking" logic for memories.

## ✨ Features

-   **Edge-Native Performance**: Deployed globally on Cloudflare's edge network.
-   **Clean Architecture**: Separation of concerns into Presentation, Service, Data, and Infrastructure layers.
-   **Robust Data Layer**: Uses Cloudflare D1 (SQLite) with Drizzle ORM for type-safe database interactions.
-   **Media Handling**: Integration with Cloudflare Images and Streams.
-   **Idempotency**: Built-in idempotency mechanisms using Cloudflare KV.
-   **Testing**: Comprehensive unit testing with Vitest.

## 🛠 Tech Stack

-   **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
-   **Framework**: [Hono](https://hono.dev/)
-   **Language**: [TypeScript](https://www.typescriptlang.org/)
-   **Databases**: [Cloudflare D1](https://developers.cloudflare.com/d1/), [Cloudflare Images](https://developers.cloudflare.com/images/), [Cloudflare Stream](https://developers.cloudflare.com/stream/)
-   **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
-   **Validation**: [Zod](https://zod.dev/)
-   **Testing**: [Vitest](https://vitest.dev/)

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v20+ recommended)
-   [pnpm](https://pnpm.io/) (Package manager)
-   [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`pnpm install -g wrangler`)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd ML-API
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Environment Setup:**
    Duplicate `.dev.vars.example` (if available) to `.dev.vars` and populate the necessary secrets.
    ```bash
    cp .dev.vars.example .dev.vars
    ```
    > Note: `.dev.vars` is intentionally ignored by Git so it can safely hold local secrets. Never commit real secrets (API keys, private keys, tokens, etc.) to tracked files.

4.  **Database Setup:**
    Generate migrations and push to the local D1 database.
    ```bash
    pnpm run db:generate
    # For local development, you might need to apply migrations to a local D1 instance
    wrangler d1 migrations apply DB --local
    ```

### Running Locally

Start the local development server:

```bash
pnpm run dev
```

The API will be available at `http://localhost:8787`.

## 📜 Scripts

| Script | Description |
| :--- | :--- |
| `pnpm run dev` | Start the local development server (Wrangler). |
| `pnpm run build` | Build the worker and output to `dist` (Dry Run). |
| `pnpm run deploy` | Deploy the worker to Cloudflare. |
| `pnpm run test` | Run unit tests with Vitest. |
| `pnpm run test:watch` | Run tests in watch mode. |
| `pnpm run typecheck` | check for TypeScript errors. |
| `pnpm run lint` | Run ESLint to check for code quality issues. |
| `pnpm run format` | Format code using Prettier. |
| `pnpm run db:generate` | Generate Drizzle migrations based on schema changes. |
| `pnpm run db:check` | Check for consistency in Drizzle schema. |

## 📂 Project Structure

The project follows a Clean / Layered Architecture pattern:

```
src/
├── common/           # Shared utilities, logging, result pattern
├── config/           # Environment configuration
├── data/             # Database layer (Schema, Repositories, Migrations)
├── infrastructure/   # External service implementations (e.g., Twilio, SMTP)
├── presentation/     # API Layer (Routes, Validation, Middleware)
├── services/         # Business Logic Layer
└── index.ts          # Application entry point & Dependency Injection
```

## 🤝 Contributing

1.  Create a feature branch (`git checkout -b feature/amazing-feature`).
2.  Commit your changes (`git commit -m 'Add some amazing feature'`).
3.  Push to the branch (`git push origin feature/amazing-feature`).
4.  Open a Pull Request.

---

Built with ❤️ 
