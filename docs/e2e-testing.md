# E2E Testing Patterns

## Location & Framework

Tests: `packages/indexer/e2e/`
Framework: Vitest
Database: Real PostgreSQL (Docker in CI, local for `pnpm test:e2e:local`)
Run from repo root: `pnpm test:e2e:local`
CI workflow: `.github/workflows/e2e-indexer.yml`

## Test Structure

```
e2e/
├── archive/
│   └── hourlyArchive.test.ts       # Archive aggregation + partition cleanup
├── epoch/
│   ├── epochProcessor/
│   │   ├── epochProcessor.test.ts   # Reward, committee, sync processing
│   │   └── mocks/                   # JSON fixtures (Gnosis chain data)
│   ├── epochCreator.test.ts         # Epoch creation logic
│   └── epochPartitioning.test.ts    # Partition management
├── slot/
│   └── slotProcessor/
│       ├── slotProcessor.test.ts    # Slot processing
│       └── mocks/                   # JSON fixtures
└── validators/
    └── validators.test.ts           # Validator init + persistence
```

## Standard Test Pattern

### Setup (`beforeAll`)

```typescript
// 1. Database connection
prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// 2. Storage classes
storage = new SomeStorage(prisma);

// 3. BeaconTime with chain config
beaconTime = new BeaconTime({
  genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
  slotDurationMs: gnosisConfig.beacon.slotDuration,
  slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
  epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
  lookbackSlot: LOOKBACK_SLOT,
});

// 4. Controllers
controller = new SomeController(storage, beaconTime);
```

### Cleanup (`beforeEach`)

- Drop all test partitions via raw SQL (`DROP TABLE IF EXISTS`)
- Delete all test data from relevant tables (`prisma.model.deleteMany()`)
- Reset control tables to initial state

### Teardown (`afterAll`)

```typescript
await EpochStorage.closePgPool(); // Close static pg pools
await ValidatorsStorage.closePgPool();
await prisma.$disconnect();
```

### Test Flow

1. Insert prerequisite data (validators, epochs, partitions)
2. Call controller method directly (NOT via XState — tests skip machine layer)
3. Query database to verify results
4. Assert specific field values

## Mock Data

### JSON Fixtures (preferred for complex data)

Real Gnosis chain data stored as JSON in `e2e/**/mocks/*.json`:

- `committee_1529553.json` — Committee data for epoch
- `rewardsAttestations_1525790.json` — Attestation rewards
- `validators.json` — Validator state data

Import pattern:

```typescript
import committeeData from './mocks/committee_1529553.json' with { type: 'json' };
```

When existing mocks are insufficient, fetch real data from beacon chain and save as new fixtures (ask user for help).

### Inline Data (for simple tests)

```typescript
await prisma.committee.createMany({
  data: [{ slot: 100, index: 0, aggregationBitsIndex: 0, validatorIndex: 1, attestationDelay: 0 }],
});
```

### BeaconClient Mocking

```typescript
mockBeaconClient = { slotStartIndexing: 32000, getAttestationRewards: vi.fn() };
controller = new SomeController(mockBeaconClient as unknown as BeaconClient, storage, beaconTime);
mockBeaconClient.getAttestationRewards.mockResolvedValueOnce(mockData);
```

## Verification Patterns

- **Record count**: `expect(results.length).toBe(N)`
- **Exact values**: `expect(record.field.toString()).toBe('value')` (BigInt as string)
- **Processing flags**: `expect(epoch.rewardsFetched).toBe(true)`
- **Idempotency**: Set flag, re-run, verify API not called
- **Partition lifecycle**: Verify partitions created/dropped via `pg_tables` query
- **Aggregation**: Verify sums, counts, JSON structures in archive tables

## When to Add/Update E2E Tests

Per `packages/indexer/AGENTS.md`:

- Adding new XState machines or states
- Changing controller business logic
- Modifying storage layer queries
- Adding new cron jobs
