# Validator inactivity detection

## Context

A beacon chain validator is expected to attest once per epoch. Each epoch, every validator is assigned exactly one slot (via the `committee` table). If the validator fails to submit its attestation on time, it counts as a miss.

The inactivity detection system evaluates each validator's most recent attestations to decide whether it is active or inactive.

## Configuration parameters

- **`slotsPerEpoch`**: Number of slots per epoch (Ethereum: 32, Gnosis: 16).
- **`maxAttestationDelay`**: Maximum number of slots a validator has for its attestation to be included and still count as on-time. Currently 5. An attestation with delay <= 5 is on-time; delay > 5 or never arrived (null) is missed.
- **`delaySlotsToHead`**: Safety margin from the chain head. The indexer never reads the current chain slot — it stays N slots behind. If the head is 100 and delaySlotsToHead is 3, the last processed slot is 97.
- **`missedAttestationsForInactivity`**: Threshold of consecutive missed attestations to mark a validator as inactive. Currently 3. If a validator's last 3 attestations were all missed, it gets marked inactive.

## Per-validator slot assignments (the committee table)

A validator does not attest at every slot. Each epoch, the beacon chain assigns each validator to exactly one slot within that epoch. This assignment is stored in the `committee` table. Different validators have different assigned slots.

For example, in epoch 250 (slots 4000–4015 on Gnosis):

- Validator 1 is assigned slot 4002
- Validator 2 is assigned slot 4003
- Validator 3 is assigned slot 4010

And in epoch 251 (slots 4016–4031):

- Validator 1 is assigned slot 4018
- Validator 2 is assigned slot 4020
- Validator 3 is assigned slot 4025

This means that when we ask "what are validator 1's last 3 attestations?", we're looking at 3 specific slots that span roughly 3 epochs — and those slots are completely different from validator 2's last 3 slots.

The `committee` table is the source of truth for which slots each validator was expected to attest at. Every query about missed attestations starts by joining against this table to get the per-validator slot assignments.

## How an attestation is determined to be missed

An attestation is considered missed when:

1. **Never arrived**: `attestation_delay IS NULL`. The validator had an assigned slot in the committee table but no inclusion was recorded.
2. **Arrived too late**: `attestation_delay > maxAttestationDelay`. The attestation was included but after the acceptable deadline.

Otherwise, the attestation is on-time.

## Safe evaluation window (maxSlotToQuery)

We cannot evaluate recent slots because attestations might not have arrived yet. A validator assigned to slot S has until slot S + maxAttestationDelay to be included.

If the indexer processed up to slot 97 (head=100, delaySlotsToHead=3), we can only judge with certainty the attestations for slots <= 97 - maxAttestationDelay = 92. An attestation for slot 92 could arrive as late as slot 97, which is exactly the last slot we processed.

The formula should be:

```
maxSlotToQuery = currentSlot - delaySlotsToHead - maxAttestationDelay
```

### Example

- Chain head: slot 200
- delaySlotsToHead: 3 → last processed slot: 197
- maxAttestationDelay: 5 → last evaluable slot: 192

Slot 192: the attestation could arrive until slot 197 (192+5). Since we processed up to 197, we can tell whether it arrived or not.
Slot 193: the attestation could arrive until slot 198. But we only processed up to 197. We cannot judge it yet.

## Inactivity window (inactivityCheckStartSlot)

A validator attests once per epoch, not once per slot. To get at least `missedAttestationsForInactivity` attestations per validator, we need to look back enough epochs.

```
inactivityCheckStartSlot = maxSlotToQuery - missedAttestationsForInactivity - (slotsPerEpoch × missedAttestationsForInactivity)
```

With Gnosis (slotsPerEpoch=16, missedAttestationsForInactivity=3):

```
inactivityCheckStartSlot = 192 - 3 - (16 × 3) = 192 - 51 = 141
```

This opens a window of ~51 slots (~3 epochs) back in time, enough for each validator to have had at least 3 opportunities to attest.

## How inactivity is decided

### Step 1: Get each validator's attestations from committee

Within the window [inactivityCheckStartSlot, maxSlotToQuery], we join against the `committee` table to get only the slots where each validator was actually assigned to attest. This is not a generic "last N slots" — it's the last N slots where that specific validator had a duty.

### Step 2: Rank per validator independently

Each validator's attestations are ranked independently using a row number partitioned by validator_index and ordered by slot descending. rn=1 is that validator's most recent assigned slot, rn=2 is the one before, etc.

For example, with maxSlotToQuery=192:

- Validator 1: rn=1 at slot 188, rn=2 at slot 172, rn=3 at slot 156 (assigned in epochs 11, 10, 9)
- Validator 2: rn=1 at slot 190, rn=2 at slot 174, rn=3 at slot 158 (assigned in different slots within those same epochs)

Each validator has its own independent ranking. "Last 3" means the last 3 for THAT validator, not the last 3 globally.

### Step 3: Evaluate the last N attestations

For each validator, we check whether the first N (missedAttestationsForInactivity=3) attestations in its ranking were all missed:

- If the 3 most recent are all missed → **inactive**
- If at least one of the 3 most recent is on-time → **active**

### Why maxSlotToQuery works as a global cutoff

Even though each validator has different assigned slots, a single global maxSlotToQuery is sufficient. The reasoning: any slot S where S <= maxSlotToQuery guarantees that S + maxAttestationDelay <= lastProcessedSlot. This means we've already processed far enough to know whether the attestation for slot S arrived or not, regardless of which validator was assigned to it.

---

## Test cases

### 1. Active validator: all attestations on-time

A validator has 3 recent attestations, all with delay <= maxAttestationDelay.
Expected result: status=active, is_inactive=false, attestations_missed=0.

### 2. Inactive validator: N consecutive missed attestations

A validator has 3 recent attestations, all with delay=null (never arrived).
Expected result: status=inactive, is_inactive=true.

### 3. Inactive validator: attestations with excessive delay

A validator has 3 recent attestations, all with delay > maxAttestationDelay (e.g., delay=6 when maxAttestationDelay=5).
Expected result: status=inactive, is_inactive=true. Even though the attestation was included, it arrived late and counts as missed.

### 4. Active validator: non-consecutive misses

A validator has 3 recent attestations: [on-time, missed, on-time] (most recent to oldest).
Expected result: status=active. The last 3 have at least one on-time, so the threshold of 3 consecutive misses is not met.

### 5. Active validator: 2 misses + 1 on-time (just below threshold)

A validator has 3 recent attestations: [missed, missed, on-time].
Expected result: status=active. Only 2 of the last 3 are missed, which doesn't reach the threshold of 3.

### 6. Slots beyond maxSlotToQuery are not evaluated

A validator has 1 attestation at slot 100 (on-time) and 3 missed attestations at slots 130, 135, 140. maxSlotToQuery is 125.
Expected result: only slot 100 is evaluated. The 3 missed ones are ignored because they fall outside the window. Status=active.

This case is critical: it prevents marking a validator as inactive when its recent attestations haven't had time to arrive yet.

### 7. Attestation with delay exactly at the limit (delay = maxAttestationDelay)

A validator has one attestation with delay exactly equal to maxAttestationDelay (5).
Expected result: on-time. The condition is `delay > maxAttestationDelay`, not `>=`. Delay=5 is not missed.

### 8. Attestation with delay = maxAttestationDelay + 1

A validator has one attestation with delay = 6 (maxAttestationDelay + 1).
Expected result: missed. One slot above the limit is already late.

### 9. Recovery from inactivity

A validator was inactive (3 consecutive misses). Then it sends an on-time attestation.
Expected result: the last 3 attestations are now [on-time, missed, missed]. Only 2 of 3 are missed → status=active. The validator recovers.

### 10. Attestation with delay=null counts as missed

A validator has 2 attestations: one with delay=null (never arrived) and one with delay=1 (on-time).
Expected result: 1 missed out of 2 total. delay=null is always missed.

### 11. Multiple validators with different states

Three validators evaluated in the same cycle: validator A has 3 on-time, validator B has 3 missed, validator C has 2 missed + 1 on-time.
Expected result: A=active, B=inactive, C=active. Evaluation is independent per validator.

### 12. Updates do not wipe performance columns

When running the attestation and status update, performance columns (performance_h, apy_h, etc.) that were written by a separate process must not be overwritten or set to null.
Expected result: performance columns are preserved intact.

### 13. Correct maxSlotToQuery calculation in the controller

The controller calculates maxSlotToQuery based on currentSlot. Verify that it uses maxAttestationDelay as the buffer and not another value, to avoid evaluating slots whose attestations might still arrive.

### 14. Validator attesting at the exact boundary of maxSlotToQuery

A validator has its attestation at exactly maxSlotToQuery.
Expected result: it is evaluated. The filter is `slot BETWEEN minSlotHour AND maxSlotToQuery` (inclusive).

### 15. Validator attesting one slot after maxSlotToQuery

A validator has its attestation at maxSlotToQuery + 1.
Expected result: it is not evaluated. It falls outside the window.
