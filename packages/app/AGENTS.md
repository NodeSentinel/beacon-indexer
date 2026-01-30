# AGENTS.md — App (Next.js frontend)

This package is the Next.js web app that consumes the API. Root project context: see repository root `AGENTS.md`.

## Setup and run

- From repo root: `pnpm dev:app` (requires API built and running if calling it).
- From this package: `pnpm dev` (Next.js dev server).
- Build: `pnpm build` (from root: `pnpm build:app`).

## Environment

- Use `.env.local` for local development.
- Only `NEXT_PUBLIC_*` variables are exposed to the browser (see root readme for templates).

## Code style and conventions

- Search the codebase before adding new components or pages; reuse existing UI and API usage patterns.
- API access is via oRPC client and TanStack Query; keep data fetching and caching in that layer.
- Always check existing components in /components before creating new ones.
