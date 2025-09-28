FROM node:18-alpine

# Install system dependencies first
RUN apk add --no-cache openssl

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy package management files first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy only the required script
COPY scripts/setDbUrl.js ./scripts/setDbUrl.js

# Copy db package files
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/db/src ./packages/db/src
COPY packages/db/prisma ./packages/db/prisma

# Copy fetch package files
COPY packages/fetch/package.json ./packages/fetch/package.json

# Install dependencies
# Disable automatic Prisma generation during install
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/fetch ./packages/fetch

# Generate Prisma client from db package
RUN npx prisma generate --schema=./packages/db/prisma/schema.prisma

# Build the db package first
RUN pnpm --filter @beacon-indexer/db run build

# Build the fetch package after db is ready
RUN pnpm --filter fetch run build

# Verify the build output
RUN ls -la packages/fetch/dist/

# Set working directory to the fetch package
WORKDIR /app/packages/fetch

CMD ["pnpm", "start"]
