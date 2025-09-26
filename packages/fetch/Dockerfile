FROM node:18-alpine

# Install system dependencies first
RUN apk add --no-cache openssl

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy package management files first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# Copy only the required script
COPY scripts/setDbUrl.js ./scripts/setDbUrl.js

# Copy fetch package files
COPY packages/fetch/package.json ./packages/fetch/package.json

# Install dependencies
# Disable automatic Prisma generation during install
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/fetch ./packages/fetch

# Generate Prisma client 
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build the fetch package from root using pnpm workspace command
RUN pnpm --filter fetch run build

# Verify the build output
RUN ls -la packages/fetch/dist/

# Set working directory to the fetch package
WORKDIR /app/packages/fetch

CMD ["pnpm", "start"]
