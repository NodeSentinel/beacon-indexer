# dataBySlot Tuple Optimization — Strip Trailing Zeros

## Problem

`dataBySlot` stores per-validator, per-slot data as JSON tuples inside `ValidatorHourlyArchive` (and propagated to daily/monthly archives). With ~1M validators per epoch (every 12s), the volume is massive.

Previous format: fixed 5-element tuples for every row:

```
[slot, attDelay, syncReward, execReward, blockReward]
```

Most fields are zero most of the time:

- **syncReward**: only ~512 validators per sync committee (~0.05% of 1M)
- **execReward/blockReward**: only 1 proposer per slot (~0.003%)
- **99.9%+ of tuples** carry three trailing `"0"` strings unnecessarily

## Design: Fixed-Position, Variable-Length Tuples (Strip Trailing Zeros)

Positions are fixed — each index always means the same field:

```
idx 0: slot        (number, absolute slot number)
idx 1: attDelay    (number, -1 if no attestation info)
idx 2: syncReward  (string, decimal)
idx 3: execReward  (string, decimal)
idx 4: blockReward (string, decimal)
```

Tuples are truncated from the right — missing trailing elements are implicitly `0`:

| Case                     | % of rows | Tuple                                       | Length |
| ------------------------ | --------- | ------------------------------------------- | ------ |
| Attestation only         | ~99.9%    | `[slot, attDelay]`                          | 2      |
| Att + sync committee     | ~0.05%    | `[slot, attDelay, "5000"]`                  | 3      |
| Att + proposer (no sync) | ~0.003%   | `[slot, attDelay, 0, "7000", "12000"]`      | 5      |
| Att + sync + proposer    | rare      | `[slot, attDelay, "5000", "7000", "12000"]` | 5      |

### Consumer contract

- Read by index position (idx 2 = sync, idx 3 = exec, idx 4 = block)
- If `tuple.length < N`, treat missing elements as `0`
- Proposer rows always include idx 2 (syncReward, even if `0`) to preserve positional integrity

### Why not a bitmask or objects?

- **Bitmask**: adds a field to every tuple, complicates read logic with bitwise ops
- **Objects with keys**: key names add significant byte overhead at this scale (1M+ rows/epoch)
- **Trailing-zero stripping**: zero added complexity for readers, maximum space savings for the dominant case

## Propagation

Daily and monthly archives concatenate hourly tuples via `jsonb_agg(elem)` — variable-length tuples flow through transparently with no changes needed to aggregation queries.

## Adding new fields in the future

- **Appending to the end**: works — existing consumers ignore unknown trailing elements
- **Inserting in the middle**: breaks positional contract — would require a new column or data migration
