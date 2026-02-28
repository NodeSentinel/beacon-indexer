# XState Machine Patterns

## Machine Location

All XState machines: `packages/indexer/src/xstate/`

```
xstate/
├── index.ts                          # initXstateMachines() — creates and wires all actors
├── pinoLog.ts                        # Shared logging helper for machines
├── epoch/
│   ├── epochOrchestrator.machine.ts  # Manages parallel epoch processing (max 3)
│   ├── epochWorker.machine.ts        # Wraps single epoch processing
│   ├── epochProcessor.machine.ts     # Coordinates all fetches for one epoch
│   └── epochCreation.machine.ts      # Creates epoch records
├── slot/
│   └── slotOrchestrator.machine.ts   # Processes slots within an epoch
├── archive/
│   ├── hourlyArchive.machine.ts      # Hourly data archival (epoch-triggered)
│   └── index.ts                      # Actor factory
└── chainStats/
    ├── chainStats.machine.ts         # Per-epoch chain statistics (epoch-triggered)
    └── index.ts                      # Actor factory
```

## Epoch Processing Flow

```
epochCreationMachine → creates epoch records in DB
epochOrchestratorMachine → polls for unprocessed epochs, spawns workers (max 3 parallel)
  └─ epochWorkerMachine → creates partitions, spawns processor
       └─ epochProcessorMachine → parallel state: committees, slots, balances, rewards
            └─ slotOrchestratorMachine → processes slots within the epoch
```

### Event Flow: EPOCH_PROCESSED

```
epochProcessorMachine: sendParent(EPOCH_COMPLETED { epoch, machineId })
  → epochWorkerMachine: sendParent(EPOCH_COMPLETED { epoch, machineId })
    → epochOrchestratorMachine: global handler
         ├─ stopChild, mark epoch completed
         └─ sendTo(actor, { type: 'EPOCH_PROCESSED', epoch })  ← for each registered actor
```

**Emission point**: `epochOrchestrator.machine.ts` — EPOCH_COMPLETED global handler
**Event payload**: `{ type: 'EPOCH_PROCESSED'; epoch: number }`
**Registered actors**: `hourlyArchiveActor`, `chainStatsActor`

## Epoch-Triggered Job Pattern (Template)

This is the standard pattern for any job that runs after each epoch. Reference: `hourlyArchive.machine.ts`.

### 1. Machine Definition (`xstate/{feature}/{feature}.machine.ts`)

```typescript
export const featureMachine = setup({
  types: {
    context: {} as { controller: FeatureController },
    events: {} as { type: 'EPOCH_PROCESSED'; epoch: number },
    input: {} as { controller: FeatureController },
  },
  actors: {
    runFeature: fromPromise(async ({ input }) => {
      return input.controller.execute(input.epoch);
    }),
  },
  guards: {
    succeeded: ({ event }) => event.output != null,
  },
}).createMachine({
  id: 'Feature',
  initial: 'idle',
  context: ({ input }) => ({ controller: input.controller }),
  states: {
    idle: {
      on: {
        EPOCH_PROCESSED: {
          target: 'processing',
          actions: [
            /* log */
          ],
        },
      },
    },
    processing: {
      invoke: {
        src: 'runFeature',
        input: ({ context, event }) => ({ controller: context.controller, epoch: event.epoch }),
        onDone: [
          {
            guard: 'succeeded',
            target: 'idle',
            actions: [
              /* log success */
            ],
          },
          {
            target: 'idle',
            actions: [
              /* log no-op */
            ],
          },
        ],
        onError: {
          target: 'idle',
          actions: [
            /* log error */
          ],
        },
      },
      on: {
        EPOCH_PROCESSED: {
          actions: [
            /* log ignored */
          ],
        }, // non-overlapping
      },
    },
  },
});
```

### 2. Actor Factory (`xstate/{feature}/index.ts`)

```typescript
export const getFeatureActor = (controller: FeatureController) => {
  const actor = createActor(featureMachine, { input: { controller } });
  actor.subscribe((snapshot) => {
    logMachine('feature', `State: ${JSON.stringify(snapshot.value)}`);
  });
  return actor;
};
```

### 3. Wiring (modifications needed)

**`xstate/index.ts`**: Accept controller, create actor, start it, pass to orchestrator.
**`epochOrchestrator.machine.ts`**: Add actor ref to context type, input type, context assignment, and add `sendTo` in EPOCH_COMPLETED handler.
**`src/index.ts`**: Instantiate storage → controller → pass to `initXstateMachines()`.

## Key Design Principles

- **Non-overlapping execution**: Ignore `EPOCH_PROCESSED` while processing (prevents concurrent runs)
- **Graceful no-ops**: Return null when no work available (not an error)
- **Error recovery**: onError returns to `idle` (machine never crashes)
- **Event transformation**: Internal `EPOCH_COMPLETED` → external `EPOCH_PROCESSED` (separation of concerns)
- **Ordered release**: Epochs released in order from lowest (see `getEpochsToRelease()`)
- **Capacity management**: `MAX_PARALLEL_EPOCHS = 3`, guard-based spawning

## Logging

All machines use `pinoLog` from `xstate/pinoLog.ts`. Log at:

- Entry to processing state (info)
- Success with result (info)
- No-op / no work (info)
- Error (error)
- Ignored events during processing (debug)
