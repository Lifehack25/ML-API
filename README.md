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
-   **Main Framework**: [Hono](https://hono.dev/)
-   **Language**: [TypeScript](https://www.typescriptlang.org/)
-   **Databases**: [Cloudflare D1](https://developers.cloudflare.com/d1/), [Cloudflare Images](https://developers.cloudflare.com/images/), [Cloudflare Stream](https://developers.cloudflare.com/stream/)
-   **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
-   **Validation**: [Zod](https://zod.dev/)
-   **Testing**: [Vitest](https://vitest.dev/)




## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later)
-   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
-   [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/ml-api.git
    cd ml-api
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Configure your environment:
    *   Copy `wrangler.toml.example` to `wrangler.toml`
    *   Update `wrangler.toml` with your Cloudflare D1 Database ID and KV Namespace ID.
    *   Create a `.dev.vars` file for local secrets (see Configuration section below).

### Local Development

Start the development server:

```bash
npm run dev
```

This will invoke `wrangler dev` and allow you to test the API locally.

## ⚙️ Configuration

### Environment Variables

The application relies on several environment variables. For local development, create a `.dev.vars` file in the root directory:

```ini
ENVIRONMENT=development
JWT_SECRET=your_jwt_secret
HASHIDS_SALT=your_hash_salt
CREATE_LOCK_API_KEY=your_api_key
PUSH_NOTIFICATION_KEY=your_push_key

# Optional Integrations
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
...
```

For production, set these secrets using Wrangler:

```bash
wrangler secret put JWT_SECRET
wrangler secret put HASHIDS_SALT
# etc...
```

### `wrangler.toml`

The `wrangler.toml` file contains the Worker configuration. Use `wrangler.toml.example` as a template. You will need to provision:
1.  **D1 Database**: `wrangler d1 create ml-api-db`
2.  **KV Namespace**: `wrangler kv:namespace create IDEMPOTENCY_KEYS`

Update the `database_id` and `id` fields in your `wrangler.toml` with the output from these commands.

## 📦 Deployment

To deploy to Cloudflare Workers:

```bash
npm run deploy
```

This uses `wrangler deploy` to publish your worker to the edge.

## 🧪 Testing

Run the test suite with Vitest:

```bash
npm test
```

To run tests in watch mode:

```bash
npm run test:watch
```
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



---

Built with ❤️ 