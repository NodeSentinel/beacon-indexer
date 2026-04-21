#!/bin/bash

# Script para ejecutar E2E tests localmente
# Uso: ./scripts/run-e2e-local.sh [package]
# package: indexer, api, o vacío para todos

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get package argument (optional)
PACKAGE="${1:-all}"

# Hardcoded e2e database settings; do not read these values from .env.
E2E_DB_NAME="e2e_beacon"
E2E_DB_USER="e2e_user"
E2E_DB_PASS="e2e_password"
E2E_DB_PORT="5499"
E2E_DB_URL="postgresql://$E2E_DB_USER:$E2E_DB_PASS@localhost:$E2E_DB_PORT/$E2E_DB_NAME?schema=public"

echo "🚀 Starting E2E tests locally (package: $PACKAGE)..."

# Check if PostgreSQL container is already running
if docker ps | grep -q "e2e-postgres"; then
    echo -e "${YELLOW}⚠️  PostgreSQL container already running, stopping it...${NC}"
    docker stop e2e-postgres || true
    docker rm e2e-postgres || true
fi

# Start PostgreSQL container with tmpfs for clean data
echo -e "${GREEN}🐳 Starting PostgreSQL container...${NC}"
docker run --name e2e-postgres \
    -e POSTGRES_DB="$E2E_DB_NAME" \
    -e POSTGRES_USER="$E2E_DB_USER" \
    -e POSTGRES_PASSWORD="$E2E_DB_PASS" \
    -p "$E2E_DB_PORT":5432 \
    --tmpfs /var/lib/postgresql/data \
    -d postgres:16

# Wait for PostgreSQL to be ready
echo -e "${GREEN}⏳ Waiting for PostgreSQL to be ready...${NC}"
for i in {1..60}; do
    if docker exec e2e-postgres pg_isready -U "$E2E_DB_USER" -d "$E2E_DB_NAME" >/dev/null 2>&1; then
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
DATABASE_URL="$E2E_DB_URL" \
pnpm --filter @beacon-indexer/db exec prisma migrate deploy --schema=prisma/schema.prisma

# Store the root directory
ROOT_DIR=$(pwd)

# Function to run indexer e2e tests
run_indexer_e2e() {
    echo -e "${GREEN}🧪 Running indexer E2E tests...${NC}"
    cd "$ROOT_DIR/packages/indexer"
    DATABASE_URL="$E2E_DB_URL" \
    pnpm test:e2e
}

# Function to run api e2e tests
run_api_e2e() {
    echo -e "${GREEN}🧪 Running API E2E tests...${NC}"
    cd "$ROOT_DIR/packages/api"
    DATABASE_URL="$E2E_DB_URL" \
    API_TOKEN_SECRET="test-secret-must-be-at-least-32-characters-long" \
    CHAIN="gnosis" \
    TELEGRAM_BOT_TOKEN="fake-token-for-e2e" \
    pnpm test:e2e
}

# Run tests based on package argument
case "$PACKAGE" in
    indexer)
        run_indexer_e2e
        ;;
    api)
        run_api_e2e
        ;;
    all|"")
        run_indexer_e2e
        run_api_e2e
        ;;
    *)
        echo -e "${RED}❌ Unknown package: $PACKAGE${NC}"
        echo "Usage: $0 [indexer|api|all]"
        exit 1
        ;;
esac

# Return to root directory
cd "$ROOT_DIR"

# Cleanup
echo -e "${GREEN}🧹 Cleaning up...${NC}"
docker stop e2e-postgres
docker rm e2e-postgres

echo -e "${GREEN}✅ E2E tests completed!${NC}"
