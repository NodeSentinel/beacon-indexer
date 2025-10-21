# NodeSentinel

[![Website](https://img.shields.io/badge/🌐_Website-node--sentinel.xyz-1a73e8?style=for-the-badge)](http://node-sentinel.xyz/)

Tools for blockchain node operators — keep your validators online, secure, and efficient.

### Monitor Your Validators

Get real-time insights and instant alerts for your Ethereum and Gnosis validators:

[![Ethereum Bot](https://img.shields.io/badge/_Ethereum_Bot-5865F2?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/ethereum_nodeSentinel_bot)
[![Gnosis Bot](https://img.shields.io/badge/_Gnosis_Bot-30B57C?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/gbc_validators_bot)

# Beacon Indexer

A lightweight beacon chain indexer for collecting and processing validator data from Ethereum and Gnosis beacon chains.

It’s easy to run — just provide a beacon API URL and the slot number to start indexing from.

The code is written in TypeScript and uses XState to orchestrate the data fetching workflow.

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

### Development only

- `cp .env.example .env`
- pnpm install
- docker compose up postgres
- pnpm db:prisma-generate
- pnpm migrate:dev
- pnpm build
- pnpm dev:fetch

## Architecture

### System Architecture

The beacon indexer follows a clean layered architecture pattern that separates concerns and ensures maintainability:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│      XState     │───▶│   Controllers    │───▶│    Storage      │
│ (State Machine) │    │  (Coordinators)  │    │   (Database)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   BeaconClient   │    │      API        │
                       │  (External API)  │    │   (REST API)    │
                       └──────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Bot & Website  │
                                               │   (Consumers)   │
                                               └─────────────────┘
```

**XState Actors**: Orchestrate the data extraction workflow from the beacon chain, managing state transitions and coordinating between different processing stages.

**Controllers**: Entity-specific controllers (Epoch, Slot, Validators) that fetch data from the beacon chain, process and transform it, and coordinate with storage layers when needed.

**Storage**: Database layer responsible for all data persistence operations using Prisma ORM and PostgreSQL.

**BeaconClient**: Handles all external API calls to the beacon chain, providing reliable data fetching with retry logic and fallback mechanisms.

**API**: REST API layer that exposes the collected data through HTTP endpoints, consuming data from the storage layer and providing it to external consumers.

**Bot & Website**: External consumers that utilize the API to provide real-time validator monitoring, alerts, and insights to users through Telegram bots and web interfaces.

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
