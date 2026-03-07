# Missed Attestations Analytics

## Overview

Add a missed attestations endpoint that serves the Analytics chart in the dashboard. Supports querying by cluster, all clusters, or individual validator, with 1h and 24h time ranges.

## Endpoints

Three routes, same handler logic:

- `GET /clusters/{id}/analytics/missed-attestations?range=1h|24h`
- `GET /clusters/all/analytics/missed-attestations?range=1h|24h`
- `GET /validators/{index}/analytics/missed-attestations?range=1h|24h`

## Response shape

```json
{
  "success": true,
  "data": [{ "timestamp": "2026-03-07T20:30:00Z", "count": 3, "validatorCount": 2 }],
  "meta": { "timestamp": "..." }
}
```

- `timestamp`: epoch start time (1h) or hour boundary (24h)
- `count`: total missed attestations in that bucket
- `validatorCount`: distinct validators that missed

## Data sources

### 1h range — `committee` table (raw data)

- Filter by cluster's validators (via `cluster_validator` join) or single validator
- Missed = `attestation_delay IS NULL OR attestation_delay > maxAttestationDelay`
- Group by epoch (derived from slot)
- Time window: slots from last ~1 hour

### 24h range — `validator_hourly_archive` table

- Filter by cluster's validators or single validator
- Use `missed_attestation_count` aggregate column (no JSON parsing)
- Group by `timestamp` (hour boundary)
- Time window: last 24 hours of archive rows

## Frontend

- Hook: `useMissedAttestations(clusterId | 'all' | null, validatorIndex | null, range)`
- Calls the appropriate endpoint based on params
- Passes result as `data` prop to `AnalyticsContent`
- Frontend handles time filtering and chart bucketing
