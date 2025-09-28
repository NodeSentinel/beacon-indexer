# NodeSentinel - Beacon Indexer

[![Website](https://img.shields.io/badge/Website-node--sentinel.xyz-blue?style=for-the-badge&logo=web)](http://node-sentinel.xyz/)

A lightweight beacon chain indexer designed to collect and process validator data from Ethereum and Gnosis beacon chains. This project implements a state machine-based architecture using XState to efficiently process blockchain data with minimal resource requirements.

## Monitor Your Validators

Keep your nodes running efficiently with real-time insights and instant alerts. Directly from Telegram.

[![Ethereum Bot](https://img.shields.io/badge/Ethereum-Bot-blue?style=for-the-badge&logo=telegram)](https://t.me/ethereum_nodeSentinel_bot)
[![Gnosis Bot](https://img.shields.io/badge/Gnosis-Bot-blue?style=for-the-badge&logo=telegram)](https://t.me/gbc_validators_bot)

## Overview

The Beacon Indexer is a highly optimized system that processes and index beacon chain data. It features intelligent data summarization strategies and automatic pruning mechanisms to maintain efficiency while providing comprehensive validator analytics.

## Requirements

- **RAM**: 2GB minimum
- **Storage**: 15GB minimum

## Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/NodeSentinel/beacon-indexer.git
   cd beacon-indexer
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Environment setup**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the services**
   ```bash
   docker compose up
   ```

## Architecture

### Packages

- **`@beacon-indexer/db`**: Database layer with Prisma ORM and PostgreSQL
- **`fetch`**: Core data collection and processing service
- **`api`**: REST API for data access (planned)

### State Machine Architecture

The system uses XState to coordinate data processing through a hierarchical state machine structure:

1. **Epoch Creator**: Initiates epoch processing
2. **Epoch Orchestrator**: Manages epoch-level coordination
3. **Epoch Processor**: Handles individual epoch processing
4. **Slot Orchestrator**: Manages slot processing within an epoch
5. **Slot Processor**: Processes individual slots and validator data

**Visual State Machine Diagram**: [View on Stately.ai](https://stately.ai/registry/editor/62068dfa-b0d5-42fc-8cfb-03389c33d4f6?machineId=1b02c5cf-605d-4ea6-afdf-3b173b4c0079&mode=design)

## Scripts

### Development

- `dev:fetch`: Start the fetch service in development mode with hot reload. Requires PostgreSQL to be running and database migrations to be applied.

### Database Management

- `migrate:create`: Create a new migration
- `migrate:dev`: Run migrations in development

### Database Operations

- `db:generate`: Generate Prisma client and build database package
- `db:studio`: Open Prisma Studio

## Testing

### Unit Tests

```bash
pnpm test
```

### E2E Tests

```bash
# Local E2E tests
pnpm test:e2e:local
```

## Support Us

If you find this project useful, consider supporting our development efforts:

**Donation Address**: `0xDA74B77BA4BE36619b248088214D807A581292C4`

**Supported Networks**: Ethereum • Gnosis • Optimism • Arbitrum • Base
