# Validator Lifecycle & Status Types

## Status Definition

**File**: `packages/beacon-utils/src/validatorStatus.ts`

Status string type and numeric mapping (from Beacon API spec):

| Status String         | Code | UI Category    | Description                                   |
| --------------------- | ---- | -------------- | --------------------------------------------- |
| `pending_initialized` | 0    | pending        | Deposit submitted, waiting to enter queue     |
| `pending_queued`      | 1    | pending        | In activation queue                           |
| `active_ongoing`      | 2    | active         | Actively participating in consensus           |
| `active_exiting`      | 3    | active_exiting | Submitted exit, still active until exit epoch |
| `active_slashed`      | 4    | slashed        | Slashed, still active until exit epoch        |
| `exited_unslashed`    | 5    | exited         | Cleanly exited, no longer active              |
| `exited_slashed`      | 6    | slashed        | Exited after being slashed                    |
| `withdrawal_possible` | 7    | exited         | Can withdraw funds                            |
| `withdrawal_done`     | 8    | exited         | Fully withdrawn                               |

```typescript
export const VALIDATOR_STATUS = {
  pending_initialized: 0,
  pending_queued: 1,
  active_ongoing: 2,
  active_exiting: 3,
  active_slashed: 4,
  exited_unslashed: 5,
  exited_slashed: 6,
  withdrawal_possible: 7,
  withdrawal_done: 8,
} as const satisfies Record<ValidatorStatus, number>;
```

## Database Storage

`Validator.status` is `Int?` (nullable) with an index.

- Null status validators are treated as attesting/active in some queries.
- UI category "inactive" is derived from missed attestations, not a beacon state.

## Common Status Groupings

### Active Validators (for queries requiring attesting validators)

Codes: `2, 3, 4` (`active_ongoing`, `active_exiting`, `active_slashed`)
Plus: validators with `null` status
**Reference**: `packages/indexer/src/services/consensus/storage/validators.ts:115-123`

### Pending Validators (entering the chain)

Codes: `0, 1` (`pending_initialized`, `pending_queued`)

### Exiting Validators

Code: `3` only (`active_exiting`)
Note: Does NOT include `exited_*` statuses — those have already exited.

### Final State Validators (won't transition further)

Codes: `5, 6, 8` (`exited_unslashed`, `exited_slashed`, `withdrawal_done`)
Note: `withdrawal_possible` (7) excluded — can still transition.

### Chain Epoch Stats Groupings (GH-65)

- `totalActiveValidators`: codes 2, 3, 4
- `totalStaked`: sum of `effectiveBalance` for codes 2, 3, 4
- `validatorsEntering`: codes 0, 1
- `validatorsExiting`: code 3 only
- `validatorsConsolidating`: count from `validator_request_consolidations` table

## Validator Data Flow

1. **Fetch**: `ValidatorsController` fetches from BeaconClient during epoch processing
2. **Store**: `ValidatorsStorage.saveValidators()` persists to `validator` table
3. **Update**: Status and balances updated each epoch before other processing
4. **Query**: Other components query `validator` table for current state (snapshot semantics)

## Consolidation Tracking

`validator_request_consolidations` table tracks consolidation events per slot.

- Populated during epoch processing from execution request data
- Schema: `(slot, source_pubkey, target_pubkey)` — composite PK
- Related slot flag: `erConsolidationsFetched` on `Slot` model
