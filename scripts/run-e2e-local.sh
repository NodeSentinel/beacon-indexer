#!/bin/bash

# Script para ejecutar E2E tests localmente
# Uso: ./scripts/run-e2e-local.sh

set -e

echo "🚀 Starting E2E tests locally..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if PostgreSQL container is already running
if docker ps | grep -q "e2e-postgres"; then
    echo -e "${YELLOW}⚠️  PostgreSQL container already running, stopping it...${NC}"
    docker stop e2e-postgres || true
    docker rm e2e-postgres || true
fi

# Start PostgreSQL container with tmpfs for clean data
echo -e "${GREEN}🐳 Starting PostgreSQL container...${NC}"
docker run --name e2e-postgres \
    -e POSTGRES_DB=beacon_test \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=password \
    -p 5433:5432 \
    --tmpfs /var/lib/postgresql/data \
    -d postgres:16

# Wait for PostgreSQL to be ready
echo -e "${GREEN}⏳ Waiting for PostgreSQL to be ready...${NC}"
for i in {1..60}; do
    if docker exec e2e-postgres pg_isready -U postgres -d beacon_test >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL is ready!${NC}"
        sleep 2  # Give it a moment to fully initialize
        break
    fi
    if [ $i -eq 60 ]; then
        echo -e "${RED}❌ PostgreSQL failed to start after 60 seconds${NC}"
        exit 1
    fi
    sleep 1
done

# Setup database
echo -e "${GREEN}🗄️  Setting up database...${NC}"
DATABASE_URL="postgresql://postgres:password@localhost:5433/beacon_test?schema=public" \
pnpm exec prisma db push --schema=./packages/db/prisma/schema.prisma

# Run E2E tests
echo -e "${GREEN}🧪 Running E2E tests...${NC}"
cd packages/fetch
DATABASE_URL="postgresql://postgres:password@localhost:5433/beacon_test?schema=public" \
pnpm test:e2e

# Cleanup
echo -e "${GREEN}🧹 Cleaning up...${NC}"
docker stop e2e-postgres
docker rm e2e-postgres

echo -e "${GREEN}✅ E2E tests completed!${NC}"
