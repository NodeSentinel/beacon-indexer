# Runtime Environment Files

NodeSentinel runtime commands load env files from:

- `env/<chain>/<env>/db.env`
- `env/<chain>/<env>/indexer.env`
- `env/<chain>/<env>/api.env`
- `env/<chain>/<env>/bot.env`
- `env/<chain>/<env>/webapp.env`

Supported chains:

- `gnosis`
- `ethereum`

Supported environments:

- `dev`
- `prod`

## Composition

`db.env` owns database connection parts and uses Docker hostnames by default:

```env
# Database parts are shared by services that need DATABASE_URL.
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=nodesentinel
POSTGRES_PASSWORD=change-me
POSTGRES_DB=nodesentinel
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public
```

Service files compose final URLs from those parts:

```env
# API composes DATABASE_URL after db.env has been loaded.
CHAIN=gnosis
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public
```

## Docker

Docker commands use the env files as-is, so hostnames should point to container names:

```sh
# Starts the full production Docker stack.
pnpm docker:up:prod -- --chain=gnosis --all

# Starts the local Docker infra plus selected services.
pnpm docker:up:dev -- --chain=gnosis --indexer --api

# Starts the full local Docker stack.
pnpm docker:up:dev -- --chain=gnosis --all
```

Production requires `--all`. Partial production stacks are rejected.

`POSTGRES_PORT` is the database port for the selected chain and environment. Docker uses the service hostname from `db.env`; standalone commands override only `POSTGRES_HOST` to `localhost`.

## Standalone Services

Standalone commands use `dotenvx --overload` and inline host overrides.

```sh
# Runs API locally against the dev database endpoint on localhost.
pnpm host:api -- --chain=gnosis --env=dev

# Runs API locally against the prod database endpoint on localhost.
pnpm host:api -- --chain=gnosis --env=prod
```

For API and indexer, the runner loads:

- `env/<chain>/<env>/db.env`
- inline `POSTGRES_HOST=localhost`
- `env/<chain>/<env>/<service>.env`

For bot, the runner loads:

- `env/<chain>/<env>/api.env`
- `env/<chain>/<env>/<service>.env`
- inline `API_URL=http://localhost:${API_PORT}`

For webapp, the runner loads:

- `env/<chain>/<env>/api.env`
- `env/<chain>/<env>/webapp.env`

## Prisma

Prisma helper commands load `env/<chain>/<env>/db.env` with `dotenvx --overload`.
The runner injects `POSTGRES_HOST=localhost` before `DATABASE_URL` is expanded.

```sh
# Uses env/gnosis/dev/db.env.
pnpm prisma:migrate -- --chain=gnosis

# Uses env/gnosis/prod/db.env.
pnpm prisma:deploy -- --chain=gnosis --env=prod
```

`--env` defaults to `dev`. `--chain` is required.
