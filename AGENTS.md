# Kaneo

Self-hosted project manager. The Hono API (`apps/api`) owns domain behavior and authorization; the React app (`apps/web`) uses the typed client from `@kaneo/libs`. PostgreSQL stores state; events and WebSockets keep clients current; Redis is optional for fan-out across API instances.

Users run this on instances they control, and changes reach existing data and deployments. Protect quick boards, simple workflows, reliable live updates, and easy self-hosting. Treat this guide as defaults; the developer's request wins.

## Principles

- Keep routine work simple: read the relevant code first, then make the smallest change that works.
- One responsibility per file. Pure helpers and types go in their own modules beside their users, with tests beside them. Split a file into a folder when it gains a second concern. Don't extract one-line wrappers.
- A single instance must work without Redis. Support both bundled same-origin and separately hosted API/web deployments.
- The API enforces authentication and permissions; a hidden UI control is not authorization. Never leak secrets or private workspace data through responses, logs, events, WebSockets, or MCP.

## Where code lives

- `apps/api` — Hono routes, controllers, database, events, integrations, WebSockets. Drizzle config in `apps/api/drizzle.config.ts`.
- `apps/web` — React UI, fetchers (`src/fetchers/`), TanStack Query hooks, realtime cache updates.
- `apps/docs` (product/API docs, `openapi.json`), `apps/site` (Next.js public site).
- `packages/libs` (typed client, URL helpers), `packages/permissions` (permission vocabulary, built-in roles), `packages/mcp` (published stdio MCP package), `packages/cli`, `packages/email`, `packages/importers`, `packages/planka-import`.
- `tests/api` (unit, picked up by `apps/api/vitest.config.ts`), `tests/api-integration` (real PostgreSQL), `tests/e2e` (Playwright, separate pnpm workspace), `tests/storage-integration` (real S3-compatible storage).
- `charts/kaneo` — Helm chart. `scripts/ci/` — Docker-based runtime checks run by CI.

## Commands

- Install: `pnpm install --frozen-lockfile`. Node `^24.11.0 || >=26`, pnpm `10.32.1`.
- `vp` (Vite+) is pinned as a workspace dependency and is not on PATH by default; use `pnpm exec vp ...` or the root/package scripts.
- Lint (no writes): `pnpm lint`. Safe autofix: `pnpm exec vp check --fix`, then inspect the diff. Format: `pnpm format`.
- Typecheck: `pnpm typecheck` (runs `check:types` per package, covering both web tsconfigs).
- Unit tests: `pnpm test`. Single package: `pnpm exec vp run --filter @kaneo/api test`. Direct runner: `pnpm exec vp test run`.
- Integration tests: `pnpm test:integration` (needs PostgreSQL and `DATABASE_URL`).
- Web dev: `pnpm --filter @kaneo/web dev`. Full dev: `pnpm dev`.
- API migrations: `pnpm --filter @kaneo/api db:generate`, then inspect the SQL; `db:migrate` applies them.
- API contract: after route or schema changes run `pnpm openapi:check:fix`. CI runs `pnpm openapi:check`.
- i18n: `pnpm i18n:check`, `pnpm i18n:check:fix`, `pnpm i18n:report`, `pnpm i18n:report:fix`, `pnpm i18n:schema`.
- CI order (`.github/workflows/ci.yml`): lint, i18n, openapi, typecheck, unit tests, build, integration tests, then Docker runtime and storage checks. Match the checks you touched.

## Following a change through

Finishing one path while leaving another stale is the common mistake. Check every surface the change touches:

- API: keep handlers thin and logic in controllers. Use `createRoute`, Zod request/response schemas, `HTTPException` for expected failures, and `requireWorkspacePermission` for workspace actions. Middleware on `createRoute` runs before validators, so it must read the raw request, not `c.req.valid()`.
- Client: use `@kaneo/libs`, fetchers, TanStack Query hooks. Update invalidation and the loading, error, and empty states.
- Realtime: if a mutation drives activity, notifications, integrations, or live UI, call `publishEvent()` and verify the event → WebSocket → cache path. Redis fan-out must stay optional.
- Data: schema and relations live in `apps/api/src/database/`.
- Public contracts: keep Zod validation and OpenAPI descriptions accurate; `apps/docs/openapi.json` is committed.
- UI copy: use static i18n keys in `i18n/`; `i18n/en-US.json` is the source. Check assign/unassign, connect/disconnect, enable/disable pairs and accessibility.
- Also consider MCP, API keys, webhooks, Docker, Helm, and docs when behavior reaches them.

## Gotchas

- Server env comes from the root `.env` (template: `.env.sample`; setup: `ENVIRONMENT_SETUP.md`). Vite-only overrides go in `apps/web/.env.local`.
- Integration tests (`tests/api-integration/setup.ts`) mock `dotenv-mono` and set env explicitly, and derive a `*_test` database name from `DATABASE_URL`. Don't point them at a real database.
- Never use production data or credentials for development or tests. Preserve unrelated work in a dirty worktree.
- Stop only processes you started and tracked. Never kill processes by broad name or path match.
- Do not commit, push, open a PR, or dispatch a release unless asked. Releases run manually from `main` via the Release workflow (`workflow_dispatch`).
- External contributions need an approved issue (`ready-for-contribution`) per `CONTRIBUTING.md`; policy is in `.github/contribution-policy.json`. Read `AI_POLICY.md` before contributing AI-assisted code.
- Keep comments for constraints and surprising decisions. Update this file only when a recurring failure shows an agent needs a durable rule.

## Verifying

Use the smallest proof that covers the behavior. Focused tests plus the affected package's typecheck usually suffice. Use integration tests for routing, authorization, PostgreSQL, and migrations. For realtime, check the event → WebSocket → cache path. Use a real browser for user-visible flows only when requested or when nothing else proves them. Run repo-wide checks (`pnpm lint`, `pnpm typecheck`, `pnpm test`) for broad cross-package changes. Report exactly what ran.
