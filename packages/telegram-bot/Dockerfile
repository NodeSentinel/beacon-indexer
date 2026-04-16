FROM node:22-alpine

# Install system dependencies required by Prisma and timezone support.
RUN apk add --no-cache openssl tzdata

# Install pnpm globally using the repo version.
RUN npm install -g pnpm@9.2.0

WORKDIR /app

# Copy workspace files first so dependency install stays cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy package manifests needed for workspace dependency resolution.
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/beacon-utils/package.json ./packages/beacon-utils/package.json
COPY packages/beacon-utils/tsconfig.json ./packages/beacon-utils/tsconfig.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/telegram-bot/package.json ./packages/telegram-bot/package.json

# Copy the Prisma schema so the db package can generate its client.
COPY packages/db/prisma ./packages/db/prisma

# Skip Prisma postinstall generation until the schema is available in the image.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Install workspace dependencies before copying the full source tree.
RUN pnpm install --frozen-lockfile

# Copy db sources before building shared workspace outputs.
COPY packages/db/src ./packages/db/src

# Generate the Prisma client required by the db and api packages.
RUN pnpm exec prisma generate --schema=./packages/db/prisma/schema.prisma

# Build the db package before building packages that consume its types.
RUN pnpm --filter @beacon-indexer/db run build

# Copy shared package sources needed by the api build.
COPY packages/beacon-utils ./packages/beacon-utils
COPY packages/api ./packages/api

# Build the api package so telegram-bot can resolve router types from dist.
RUN pnpm --filter @beacon-indexer/api run build

# Copy telegram-bot source after shared package builds to preserve cache.
COPY packages/telegram-bot ./packages/telegram-bot

# Build the telegram-bot package after shared workspace types are ready.
RUN pnpm --filter telegram-bot run build

# Run commands from the telegram-bot package directory.
WORKDIR /app/packages/telegram-bot

CMD ["pnpm", "start"]
