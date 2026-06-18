# AGENTS.md — Consensus Utils

This package contains shared beacon chain utilities used across all other packages. Root project context: see repository root `AGENTS.md`.

## Purpose

Single source of truth for beacon chain calculations and configuration. All packages import from here to avoid duplication.

## Key modules

### BeaconTime (`beaconTime.ts`)

Time calculations for beacon chain:

- Convert between slots, epochs, and wall-clock time.
- Get current slot/epoch.
- Calculate time boundaries for archiving.

### Chains Config (`config/chain.ts`)

### Validator Status (`validatorStatus.ts`)

Note: "inactive" is a **derived state** (based on missed attestations), not a blockchain state. See root `AGENTS.md` for details.
