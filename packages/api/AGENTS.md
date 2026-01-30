# AGENTS.md — API

This package is the API layer that exposes indexed data. Root project context: see repository root `AGENTS.md`.

The API supports **both REST and RPC** implemented with **oRPC**; any new procedures or routes must be exposed on both transports.

## Setup and run

- From repo root: `pnpm dev:api` or `pnpm build:api`.
- From this package: `pnpm dev` (development server).

## Backend conventions

- Validate all inputs with Zod.
- Use Prisma ORM where possible for database access.

## Storage (read/write)

When building endpoints that read or write data, follow the guidelines in **`packages/db/AGENTS.md`**.
