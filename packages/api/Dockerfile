FROM node:22-alpine

# Install system dependencies (openssl for Prisma, tzdata for timezone support)
RUN apk add --no-cache openssl tzdata

# Install pnpm globally (pinned to match repo)
RUN npm install -g pnpm@9.2.0

WORKDIR /app

# Copy package management files first (for caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy only package.json and tsconfig for each package (minimal files needed for install)
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/beacon-utils/package.json ./packages/beacon-utils/package.json
COPY packages/beacon-utils/tsconfig.json ./packages/beacon-utils/tsconfig.json
COPY packages/api/package.json ./packages/api/package.json

# Copy Prisma schema (needed for prisma generate during postinstall, but we skip it)
COPY packages/db/prisma ./packages/db/prisma

# Install dependencies (this layer will be cached unless package files change)
# Disable automatic Prisma generation during install
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN pnpm install --frozen-lockfile

# Now copy source code (changes here won't invalidate the install cache)
COPY packages/db/src ./packages/db/src
COPY packages/beacon-utils ./packages/beacon-utils
COPY packages/api ./packages/api
COPY scripts/setDbUrl.js ./scripts/setDbUrl.js

# Generate Prisma client from db package
RUN pnpm exec prisma generate --schema=./packages/db/prisma/schema.prisma

# Build the db package first
RUN pnpm --filter @beacon-indexer/db run build

# Set working directory to the api package
WORKDIR /app/packages/api

CMD ["pnpm", "start"]

