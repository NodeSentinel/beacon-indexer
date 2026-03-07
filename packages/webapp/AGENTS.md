# AGENTS.md — App (Next.js frontend)

This package is the Next.js web app that consumes the API. Root project context: see repository root `AGENTS.md`.

## Setup and run

- From repo root: `pnpm dev:app` (requires API built and running if calling it).
- From this package: `pnpm dev` (Next.js dev server).
- Build: `pnpm build` (from root: `pnpm build:app`).

## Environment

- Use `.env.local` for local development.
- Only `NEXT_PUBLIC_*` variables are exposed to the browser (see root readme for templates).

## Key pages

### Dashboard (`/`)

Main monitoring page with:

- **Chain Statistics**: Global blockchain stats.
- **Cluster selector**: Dropdown to choose a cluster or "All".
- **Performance summary**: Validator states, balances, performance by timeframe.
- **Performance table**: APY, consensus rewards, missed rewards, execution rewards by period.
- **Events tabs**: Blocks, deposits, withdrawals, consolidations, incidents.

### Validator page (`/validator/[id]`)

Individual validator details:

- Same structure as dashboard but for single validator.
- Analytics, reward history, events.

## Data flow

1. API calls via oRPC client.
2. TanStack Query for caching and state management.
3. Components receive data as props, no direct API calls in components.

## Code style and conventions

- Search the codebase before adding new components or pages; reuse existing UI and API usage patterns.
- API access is via oRPC client and TanStack Query; keep data fetching in that layer.
- Always check existing components in `/components` before creating new ones.

## UI components

- Use Radix UI for headless components.
- Tailwind CSS for styling.
- Recharts for charts.
- Framer Motion for animations.
