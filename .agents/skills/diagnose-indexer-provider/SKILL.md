---
name: diagnose-indexer-provider
description: Diagnose slow NodeSentinel indexer progress from sanitized logs, with emphasis on distinguishing archive Beacon, full Beacon, and execution RPC latency. Use when indexing is slow, lag is growing, provider requests time out, or an operator asks which upstream provider is responsible. Exclude database analysis unless the user explicitly requests it.
---

# Diagnose Indexer Provider Performance

Run this workflow from the repository root. Start with logs and inspect source only when a
specific behavior remains unclear. Do not inspect database activity or storage performance unless
the user explicitly expands the scope.

## Safety

- Never run `printenv` or expose provider URLs, API keys, tokens, authorization headers, or
  database credentials.
- Never give raw indexer logs to the model. Sanitize them first.
- Store temporary output under `/tmp`, not in the repository.
- Do not modify containers, restart services, or send provider requests during diagnosis.

## Collect

Confirm container names and uptime:

```bash
docker container ls --format '{{.Names}} {{.Status}}'
```

Sanitize a recent window of container logs:

```bash
docker container logs --since 15m indexer 2>&1 \
  | .agents/skills/diagnose-indexer-provider/scripts/sanitize-indexer-logs.sh \
  > /tmp/indexer-provider.log
```

Sanitize the persisted error log when it exists:

```bash
.agents/skills/diagnose-indexer-provider/scripts/sanitize-indexer-logs.sh \
  packages/indexer/logs/errors-latest.log \
  > /tmp/indexer-provider-errors.log
```

Use Loki only when task durations are needed and it is available:

```bash
curl -sG http://127.0.0.1:3100/loki/api/v1/query_range \
  --data-urlencode 'query={job="indexer-task-monitor"}' \
  --data-urlencode 'since=15m' \
  --data-urlencode 'limit=500'
```

Do not make Loki availability a prerequisite. Container and persisted logs are sufficient for the
provider diagnosis.

## Inspect

Read focused slices rather than the complete sanitized files:

```bash
rg '\[HTTP\]|ETIMEDOUT|ECONNABORTED|timeout|Failed attempt|429| 5[0-9][0-9] ' \
  /tmp/indexer-provider.log /tmp/indexer-provider-errors.log

rg 'Lag:|Completed slot' /tmp/indexer-provider.log

rg 'Waiting for prior epoch slots|Queue after dequeue' /tmp/indexer-provider.log
```

Group observations by provider and endpoint. Record representative normal responses and outliers;
do not infer provider health from one request.

## Interpret

- `[ARCHIVE]` or `"nodeType":"archive"` identifies the archive Beacon provider.
- `[FULL]` or `"nodeType":"full"` identifies the full Beacon provider.
- Execution JSON-RPC requests normally appear as `POST /v2/<redacted>` without a Beacon node type.
- `GET /eth/v2/beacon/blocks/:slot` fetches the Beacon block.
- `POST /eth/v1/beacon/states/:slot/validators` fetches validator state from archive.
- `POST /eth/v1/beacon/rewards/attestations/:epoch` fetches epoch rewards from archive.
- Delayed block and sync committee reward requests are routed to archive.
- Proposer duties are routed to full.
- A 404 saying a Beacon block does not exist usually represents a legitimate missed slot. Do not
  classify it as provider slowness.
- Timeouts, connection aborts, 429 responses, repeated retries, and 5xx responses are provider
  failure signals.
- Later epochs wait for earlier epoch slots. A slow upstream request can therefore delay multiple
  queued epochs.
- Compare slot completion speed with Ethereum's 12-second slot interval. Faster than 12 seconds per
  indexed slot means the service can catch up while conditions remain stable; slower means lag grows.
- A recent container restart can explain a temporary increase in lag.

Keep archive provider latency distinct from NodeSentinel's Hourly/Daily Archive processes. They
share the word "archive" but are unrelated systems.

## Calculate Operational Metrics

Use one consistent measurement window based on the timestamps of the first and last
`Completed slot` lines. Do not divide a lag change by the requested log window unless the lag
samples actually span that entire window.

- `processed slots = last completed slot - first completed slot`
- `average slot processing = elapsed seconds / processed slots`
- `estimated epoch processing = average slot processing * slots per epoch`
- `indexing speed = processed slots / elapsed hours`
- `chain growth = 3600 / chain slot duration`
- `recovery speed = indexing speed - chain growth`
- `behind head = latest lag * chain slot duration`
- `estimated catch-up = latest lag / recovery speed`

Ethereum has a 12-second slot duration, 32 slots per epoch, and therefore grows by 300 slots per
hour. For another chain, use its configured slot duration and slots per epoch. If the chain cannot
be identified safely, mark chain growth, recovery speed, delay, and catch-up time as unavailable
instead of assuming Ethereum.

Use `Recovering` when recovery speed is positive and observed lag is decreasing. Use
`Falling behind` when recovery speed is zero or negative or observed lag is increasing. If these
signals disagree, state that the status is uncertain.

For provider performance, report the arithmetic mean response time for each relevant endpoint.
Show the operation name and normalized endpoint together. Do not report percentiles unless the
user explicitly asks for them. Mark providers without requests in the measurement window as
`No requests observed`.

## Source Map

Do not read source before inspecting logs. If needed, select at most three files initially, locate
the relevant symbol with `rg -n`, and read only the surrounding lines.

| Question                                                      | Source                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Which calls use archive or full, and what are their timeouts? | `packages/indexer/src/services/consensus/beacon.ts`                      |
| How do retries and provider fallback work?                    | `packages/indexer/src/services/consensus/utils/reliableRequestClient.ts` |
| Is local request rate limiting involved?                      | `packages/indexer/src/services/consensus/utils/rateLimiter.ts`           |
| How does execution RPC behave?                                | `packages/indexer/src/services/execution/execution.ts`                   |
| How are HTTP duration and node type logged?                   | `packages/indexer/src/lib/httpPino.ts`                                   |
| Which parallel tasks must finish before a slot completes?     | `packages/indexer/src/xstate/slot/slotProcessor.machine.ts`              |
| Why does an epoch wait for previous slots?                    | `packages/indexer/src/xstate/epoch/epochProcessor.machine.ts`            |
| How are slots selected sequentially?                          | `packages/indexer/src/xstate/slot/slotOrchestrator.machine.ts`           |
| How are slot attestations and rewards processed?              | `packages/indexer/src/services/consensus/controllers/slot.ts`            |
| How are epoch reward requests batched?                        | `packages/indexer/src/services/consensus/controllers/epoch.ts`           |
| How are validator state requests batched?                     | `packages/indexer/src/services/consensus/controllers/validators.ts`      |
| How is lag calculated and reported?                           | `packages/indexer/src/xstate/lagAlerting/lagAlerting.machine.ts`         |
| What produces Grafana task duration events?                   | `packages/indexer/src/xstate/monitoring/taskMonitor.ts`                  |

Read `packages/indexer/AGENTS.md` before source inspection. Do not inspect
`packages/indexer/src/services/consensus/storage/` or database code for a provider-only diagnosis.

## Report

Return this concise operational report. Format durations for humans and round rates to whole slots
per hour. Include up to three slow endpoints, ordered from slowest to fastest.

```text
Status: <Recovering | Falling behind | Uncertain>

Behind head: <duration>
Average slot processing: <duration>
Estimated epoch processing: <duration>

Indexing speed: <slots/hour>
Recovery speed: <slots/hour>
Estimated catch-up: <duration | Not recovering>

Main bottleneck: <provider name>

Slow endpoints:
- <operation>: <average response time>
  <METHOD normalized endpoint>
- <operation>: <average response time>
  <METHOD normalized endpoint>
- <operation>: <average response time>
  <METHOD normalized endpoint>

Comparison:
- Execution RPC: <average response time | No requests observed>
- Full Beacon API: <average response time | No requests observed>

Current condition:
<One or two sentences explaining whether the indexer is recovering and whether recent timeouts,
rate limits, retries, or server errors were detected.>
```

The main bottleneck line must name the provider, while the slow-endpoint list must explain exactly
which operations make it slow. Do not describe a provider as slow without listing supporting
endpoints. State explicitly when evidence is insufficient to distinguish archive, full, or
execution.
