# VMaaS — Vending Machine as a Service

A multi-tenant platform for running a fleet of vending machines. Operators (tenants) sign up, pay a subscription,
register their machines, stock them with products and follow sales and alerts from an admin dashboard. The physical
machines are ESP32-based and talk to the platform over mutually authenticated TLS.

## Architecture

![Production deployment diagram](docs/deployment%20diagram.jpg)

| Part | What it does |
| --- | --- |
| [backend/](backend/) | REST API (port 5000), auth (Better Auth), RBAC, Stripe billing, device API, MQTT client, WebSocket push for live alerts. |
| [admin-frontend/](admin-frontend/) | Next.js 16 App Router admin UI with shadcn/ui and Tailwind v4 (port 3000). |
| [shared/](shared/) | `@vmaas/shared` — Zod schemas and TS types used by both backend and frontend, **plus** `vmaas-*` PlatformIO libraries shared by both firmwares. |
| [Main-Controller/](Main-Controller/) | Firmware for the machine's brain: keypad, display, Wi-Fi/BLE provisioning, activation, purchases, door lock, offline event outbox. |
| [Motorcontrol/](Motorcontrol/) | Firmware for the motor driver. Receives commands from the Main-Controller over UART and turns the slot steppers. |
| [docker/](docker/), [config/](config/) | Compose files (dev + prod), nginx, EMQX config, env-var templates. |
| [docs/](docs/) | Guides, API reference, OpenAPI spec, design specs. |

## Getting started

**Prerequisites:** Node 24, Docker with Compose, and (for firmware only) PlatformIO.

```bash
npm run create-envs   # copies config/environment-variables/.env.*.example → .env.*.dev and writes backend/.env
npm install           # installs backend + admin-frontend
npm run dev           # starts the whole stack in Docker and watches the frontend for changes
```

Before `npm run dev`, open `config/environment-variables/.env.backend.dev` and fill in at least:

- `STRIPE_SECRET_KEY` and `EMQX_DASHBOARD__DEFAULT_PASSWORD` — compose refuses to start without them.
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — the platform superadmin created by the seed. This is your first login.

Then open **http://localhost**. nginx serves the frontend on `/` and proxies `/api` to the backend, so everything is one
origin and cookies just work.

The backend container migrates, generates the Prisma client and seeds the database every time it starts, so a fresh
`npm run dev` always gives you a working database. Run `npm run seed:dev` for demo data.

### What's running

| URL / port | Service |
| --- | --- |
| http://localhost | nginx → frontend + `/api` |
| localhost:5000 | backend directly (`/api/health`) |
| localhost:5432 | Postgres |
| localhost:8883 | EMQX MQTT broker (mTLS) |
| http://localhost:18083 | EMQX dashboard |
| localhost:8443 | nginx device API (mTLS) |

`stripe-cli` forwards Stripe webhooks to the backend, and `pki-init` creates the certificate authority used for machine
certificates on first start.

### Common commands

| Command | Where | Does |
| --- | --- | --- |
| `npm run dev-rebuild` | root | Same as `dev`, but rebuilds images. Use after changing a Dockerfile or dependencies. |
| `npm run prisma:generate` | root | Regenerates the Prisma client after a schema change. |
| `npx prisma migrate dev --name <name>` | backend | Creates a new migration. |
| `npm test` / `npm run typecheck` | backend | Vitest / `tsc --noEmit`. |
| `npm test` / `npm run typecheck` / `npm run lint` | admin-frontend | Vitest / `tsc --noEmit` / ESLint. |
| `npm run fake-machine -- --machine <id> --code <code> --ca ./ca.crt` | backend | Simulates a machine activating and connecting, without hardware. |
| `pio run -t upload` | Main-Controller, Motorcontrol | Builds and flashes firmware. |

## Key concepts

### Multi-tenancy and permissions

Everything belongs to a **tenant** (an operator company). Users are members of one or more tenants through roles, and
roles grant permissions. This lives in our own `Tenant` / `Role` / `Permission` / `UserRole` tables —
[backend/src/lib/rbac.ts](backend/src/lib/rbac.ts) is the single source of truth, and the permission keys are shared
from [shared/types/permissions.ts](shared/types/permissions.ts) so the seed, API and UI agree.

- The session carries an `activeTenantId`. Switch tenant with `POST /api/auth/tenant/switch`.
- Platform superadmins are a `User.isSuperAdmin` flag and get every permission in every tenant.
- **The backend guards every request**: `requireAuth → requireTenant → requirePermission(...)`. Controllers read the
  tenant from `req.tenantId`, never from the request body.
- The frontend's permission checks only decide what to show. They are not security.

### Backend layering

`routes` → `controllers` → `services`, in [backend/src/api/](backend/src/api/).

- **Routes** chain the auth middleware and `validate(schema)` with a Zod schema from `shared/schemas`.
- **Controllers** turn results into HTTP status codes.
- **Services** talk to Prisma and return a `Result` tuple (`ok(value)` / `err({ reason })`) instead of throwing.
  Controllers `switch` on the reason exhaustively.

`products.*` is the reference implementation — copy its shape for new features.

The database uses three Postgres schemas: `auth` (Better Auth), `rbac` and `public` (everything else). See
[backend/prisma/schema.prisma](backend/prisma/schema.prisma).

### Frontend data flow

**page / server action → [lib/dal.ts](admin-frontend/lib/dal.ts) → `lib/data/*` → API**

- `lib/dal.ts` (`requireUser`, `requirePermission`, …) checks access and returns the tenant ID to use.
- `fetchData` in `lib/data/data-fetch.ts` is the one way to call the API. On the server it forwards the auth cookie;
  in the browser it sends credentials.
- `cacheComponents` is on in Next 16. Anything that reads cookies is dynamic. Guard each page on its own, not in a
  layout. [app/(protected)/products/page.tsx](<admin-frontend/app/(protected)/products/page.tsx>) is the pattern to copy.
- This Next.js version has breaking changes. Read `admin-frontend/node_modules/next/dist/docs/` before writing App
  Router code.

### How a machine connects

1. An admin creates a machine in the UI and gets a **one-time setup code**.
2. The machine is put on Wi-Fi from its keypad or with the ESP BLE Provisioning app
   ([guide](docs/guides/first-time-setup.md)).
3. It generates its own key pair and sends a CSR + the code to `POST /api/device/activate`. It gets back a client
   certificate signed by the platform CA.
4. From then on it uses that certificate (mTLS) for:
   - **HTTPS** on `:8443` (`/api/device/*`) — fetch configuration, report events and sales, return command results.
   - **MQTT** on `:8883` — receive commands on `v1/{tenantId}/{siteId}/{machineId}/commands`.
5. Inside the machine, the Main-Controller drives the Motorcontrol board over a small binary UART protocol
   ([shared/vmaas-protocol/PROTOCOL.md](shared/vmaas-protocol/PROTOCOL.md)).

Live alerts reach the browser over a WebSocket at `/api/ws`.

## Conventions

- All user-facing text is **English**.
- Shared code is imported as `@vmaas/shared/schemas` / `@vmaas/shared/types`.
- Zod v4 everywhere (`zod/v4`).
- Formatting: backend and shared use semicolons and 120 columns. The admin-frontend uses **no semicolons** and 80
  columns. Run Prettier in the package you're editing.
- Never edit `backend/src/generated/prisma/**` by hand.
- Keep it simple. Less is more.

## CI and deployment

- **Pull requests to `main`** run backend typecheck + tests and frontend lint + typecheck + tests + production build
  ([.github/workflows/check.yml](.github/workflows/check.yml)).
- **Pushes to `main`** run the same checks, then deploy to production on a self-hosted runner.
- Production is one Docker host running [docker/docker-compose.prod.yml](docker/docker-compose.prod.yml). See
  [docs/guides/production-deployment.md](docs/guides/production-deployment.md).

## Further reading

| Doc | For |
| --- | --- |
| [docs/api-endpoints.md](docs/api-endpoints.md) / [docs/openapi.yaml](docs/openapi.yaml) | Every API endpoint (the endpoint reference is in Danish). |
| [docs/guides/first-time-setup.md](docs/guides/first-time-setup.md) | Bringing a physical machine online. |
| [docs/guides/production-deployment.md](docs/guides/production-deployment.md) | Running the stack in production. |
