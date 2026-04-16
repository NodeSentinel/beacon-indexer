FROM node:22-alpine

# Install system dependencies (tzdata for timezone support)
RUN apk add --no-cache tzdata

# Install pnpm globally (pinned to match repo)
RUN npm install -g pnpm@9.2.0

WORKDIR /app

# Copy package management files first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy workspace package manifests needed for install resolution
COPY packages/api/package.json ./packages/api/package.json
COPY packages/telegram-bot/package.json ./packages/telegram-bot/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the shared api package because telegram-bot imports its router types
COPY packages/api ./packages/api

# Copy telegram-bot source code
COPY packages/telegram-bot ./packages/telegram-bot

# Build the telegram-bot package
RUN pnpm --filter telegram-bot run build

# Set working directory to the telegram-bot package
WORKDIR /app/packages/telegram-bot

CMD ["pnpm", "start"]
