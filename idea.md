# NodeSentinel Dashboard - Diseño y Scope

## Páginas principales

- **Dashboard** (`packages/webapp/app/page.tsx`): Para usuarios que registran validadores en clusters/grupos. Pueden ver stats de un cluster en particular o todos.
- **Validator page** (`packages/webapp/app/validator/[id]/page.tsx`): Información detallada de un validador individual.

---

## Decisiones de Arquitectura

### Deployment

- **Single-chain por instancia**: Cada deployment trabaja con una sola chain (Ethereum o Gnosis), configurada via variables de entorno.
- El código es el mismo para ambas chains.

### Modelo de Datos - Clusters

- **Estructura**: `User → n Clusters → n Validators` (via `ClusterValidator`)
- **No hay relación directa** User → Validator. Todo pasa por clusters.
- Un validador puede estar en múltiples clusters del mismo usuario.
- Clusters son **privados por defecto**, con opción de compartir.
- Para "All clusters", se suman todos los validadores de todos los clusters del usuario.

### Storage Strategy

- **Una sola tabla `validators_snapshot_stats`** para todos los datos de snapshot.
- Crece horizontalmente (más columnas) no verticalmente (más filas).
- Solo incluye **validadores registrados** (los que pertenecen a algún cluster).
- Cada cron job actualiza las columnas que necesita.
- **Sin timestamps por columna** - asumimos datos frescos si el indexer corre.

### Cron Jobs

- **Todos corren en el Indexer** (XState), no en la API.
- Usan **tiempo de beacon** (epochs/slots) en lugar de wall-clock time.
- Conversiones aproximadas:
  - 30 min ≈ 5 epochs
  - 6 horas ≈ 56 epochs
  - 12 horas ≈ 112 epochs
  - 24 horas ≈ 225 epochs
- **Excepción**: Backfill check corre cada ~10 segundos para buena UX de nuevos usuarios.

### Archive Tables

- **Tablas separadas** por periodo: `ValidatorHourlyArchive`, `ValidatorDailyArchive`, `ValidatorWeeklyArchive`, `ValidatorMonthlyArchive`.
- **Particionadas por timestamp** siguiendo el patrón existente.
- **Desglose completo** de rewards (head/target/source/inactivity) en TODAS las archive tables.
- **Transacción atómica**: archivar + eliminar source data en la misma tx. Sin datos duplicados nunca.
- **Cascada de archivado**:
  - Raw → Hourly: mantener ~60 min de raw
  - Hourly → Daily: mantener ~24h de hourly
  - Daily → Weekly: mantener ~7 días de daily
  - Daily → Monthly: mantener ~30 días de daily

### Queries

- **Raw SQL** para queries de performance, no Prisma models.
- La blockchain maneja volúmenes muy grandes de información.

---

## Modelo de Datos - Nuevas Tablas

### Cluster

```prisma
model Cluster {
  id         String   @id @default(cuid())
  name       String
  ownerId    BigInt   @map("owner_id")
  visibility String   @default("private") // 'private' | 'shared'
  createdAt  DateTime @default(now()) @map("created_at")

  owner      User     @relation(fields: [ownerId], references: [id])
  validators ClusterValidator[]
  incidents  Incident[]

  @@map("cluster")
}

model ClusterValidator {
  clusterId      String @map("cluster_id")
  validatorIndex Int    @map("validator_index")

  cluster   Cluster   @relation(fields: [clusterId], references: [id], onDelete: Cascade)
  validator Validator @relation(fields: [validatorIndex], references: [id], onDelete: Cascade)

  @@id([clusterId, validatorIndex])
  @@map("cluster_validator")
}
```

### ChainEpochStats

```prisma
model ChainEpochStats {
  epoch                   Int @id @map("epoch")
  totalActiveValidators   Int @map("total_active_validators")
  totalStaked             BigInt @map("total_staked") // suma de effective balances
  validatorsEntering      Int @map("validators_entering") // pending activation
  validatorsExiting       Int @map("validators_exiting") // pending exit
  validatorsConsolidating Int @map("validators_consolidating")

  @@map("chain_epoch_stats")
}
```

### ValidatorsSnapshotStats (expandida)

```prisma
model ValidatorsSnapshotStats {
  validatorIndex Int @id @map("validator_index")

  // Estado
  status     String  @map("status") // estado blockchain
  isInactive Boolean @default(false) @map("is_inactive") // derivado de attestations perdidas

  // Balances
  balance          BigInt @map("balance")
  effectiveBalance BigInt @map("effective_balance")

  // Performance por timeframe (ratio attestationsOnTime/total)
  performance1h Decimal? @map("performance_1h") @db.Decimal(5, 4)
  performance1d Decimal? @map("performance_1d") @db.Decimal(5, 4)
  performance1w Decimal? @map("performance_1w") @db.Decimal(5, 4)
  performance1m Decimal? @map("performance_1m") @db.Decimal(5, 4)

  // APY por timeframe (simple anualizado: rewards/balance * periodos_por_año)
  apy1h Decimal? @map("apy_1h") @db.Decimal(5, 2)
  apy1d Decimal? @map("apy_1d") @db.Decimal(5, 2)
  apy1w Decimal? @map("apy_1w") @db.Decimal(5, 2)
  apy1m Decimal? @map("apy_1m") @db.Decimal(5, 2)

  // Rewards totales por timeframe (sin desglose head/target/source)
  consensusReward1h BigInt? @map("consensus_reward_1h")
  consensusReward1d BigInt? @map("consensus_reward_1d")
  consensusReward1w BigInt? @map("consensus_reward_1w")
  consensusReward1m BigInt? @map("consensus_reward_1m")

  missedReward1h BigInt? @map("missed_reward_1h")
  missedReward1d BigInt? @map("missed_reward_1d")
  missedReward1w BigInt? @map("missed_reward_1w")
  missedReward1m BigInt? @map("missed_reward_1m")

  executionReward1h Decimal? @map("execution_reward_1h") @db.Decimal(78, 0)
  executionReward1d Decimal? @map("execution_reward_1d") @db.Decimal(78, 0)
  executionReward1w Decimal? @map("execution_reward_1w") @db.Decimal(78, 0)
  executionReward1m Decimal? @map("execution_reward_1m") @db.Decimal(78, 0)

  @@map("validators_snapshot_stats")
}
```

### Archive Tables (Daily, Weekly, Monthly)

Mismo patrón que `ValidatorHourlyArchive`, particionadas por timestamp.
Incluyen desglose completo: head, target, source, inactivity (rewards y missed).

### Incident / IncidentValidator

```prisma
model Incident {
  id        String    @id @default(cuid())
  clusterId String    @map("cluster_id")
  startedAt DateTime  @map("started_at")
  endedAt   DateTime? @map("ended_at") // null si abierto
  status    String    @default("open") // 'open' | 'resolved'

  // Métricas de impacto
  affectedValidatorsCount  Int     @default(0) @map("affected_validators_count")
  missedAttestationRewards BigInt  @default(0) @map("missed_attestation_rewards")
  missedBlockRewards       BigInt? @map("missed_block_rewards")
  missedSyncRewards        BigInt? @map("missed_sync_rewards")
  totalMissedRewards       BigInt  @default(0) @map("total_missed_rewards")

  cluster    Cluster             @relation(fields: [clusterId], references: [id])
  validators IncidentValidator[]

  @@map("incident")
}

model IncidentValidator {
  incidentId     String    @map("incident_id")
  validatorIndex Int       @map("validator_index")
  becameInactiveAt DateTime @map("became_inactive_at")
  recoveredAt    DateTime? @map("recovered_at") // null si aún inactivo

  // Métricas por validador
  missedAttestationRewards BigInt  @default(0) @map("missed_attestation_rewards")
  missedBlockRewards       BigInt? @map("missed_block_rewards")
  missedSyncRewards        BigInt? @map("missed_sync_rewards")

  incident Incident @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  @@id([incidentId, validatorIndex])
  @@map("incident_validator")
}
```

---

## Cron Jobs (Indexer - XState)

| Job                     | Trigger                              | Acción                                         |
| ----------------------- | ------------------------------------ | ---------------------------------------------- |
| Snapshot status/balance | EPOCH_PROCESSED                      | Actualiza status, isInactive, balance          |
| Snapshot inactive check | SLOT_PROCESSED + maxAttestationDelay | Actualiza isInactive basado en attestations    |
| Snapshot performance 1h | EPOCH_PROCESSED                      | Calcula performance última hora                |
| Snapshot performance 1d | ~225 epochs                          | Calcula performance último día                 |
| Snapshot performance 1w | ~1575 epochs                         | Calcula performance última semana              |
| Snapshot performance 1m | ~6750 epochs                         | Calcula performance último mes                 |
| Daily archive           | EPOCH_PROCESSED                      | Archiva hourly→daily cuando hay 24h+           |
| Weekly archive          | EPOCH_PROCESSED                      | Archiva daily→weekly cuando hay 7d+            |
| Monthly archive         | EPOCH_PROCESSED                      | Archiva daily→monthly cuando hay 30d+          |
| Chain stats             | EPOCH_PROCESSED                      | Guarda stats globales en chain_epoch_stats     |
| Backfill check          | ~10 segundos                         | Busca validadores sin snapshot y hace backfill |
| Incident detection      | EPOCH_PROCESSED                      | Detecta/actualiza/cierra incidents             |

### Estado "inactivo" derivado

- Un validador se considera inactivo si perdió `missedAttestationsForInactivity` attestations consecutivas.
- Una attestation se considera perdida si `delay > maxAttestationDelay`.
- El estado se puede calcular solo cuando el indexer procesa `attestation_slot + maxAttestationDelay`.

### Backfill de nuevos validadores

- El indexer chequea periódicamente (~10s) validadores en clusters que no tienen row en `validators_snapshot_stats`.
- Les hace backfill con datos históricos para buena UX.

---

## Endpoints API

### Chain Stats

- `GET /chain/stats` → lee de `chain_epoch_stats`

### Clusters (CRUD)

- `POST /clusters` → crear cluster
- `GET /clusters` → listar clusters del usuario
- `PUT /clusters/:id` → editar nombre/visibilidad
- `DELETE /clusters/:id` → eliminar cluster
- `POST /clusters/:id/validators` → agregar validadores
- `DELETE /clusters/:id/validators/:validatorIndex` → quitar validador

### Dashboard Stats

- `GET /clusters/:id/stats` → resumen desde validators_snapshot_stats
- `GET /clusters/all/stats` → todos los clusters del usuario

### Eventos (paginados, por tipo)

- `GET /clusters/:id/events/blocks`
- `GET /clusters/:id/events/deposits`
- `GET /clusters/:id/events/withdrawals`
- `GET /clusters/:id/events/consolidations`
- `GET /clusters/:id/events/incidents`

### Validator individual

- `GET /validators/:index` → datos del validador
- `GET /validators/:index/performance` → performance desde snapshot
- `GET /validators/:index/events/blocks`
- `GET /validators/:index/events/deposits`
- `GET /validators/:index/events/withdrawals`

### Paginación

- Solo para listados de UI (validadores, eventos, historial).
- Stats agregadas siempre suman todos los validadores del cluster.

---

## Diferido para Futuro

### Listado histórico detallado de rewards/attestations

El usuario selecciona:

- Tipo: `attestations | rewards`
- Timeframe: `1h | 1d | 1w | 1m | all`
- Agrupación: por minuto, hora, día, semana (API o FE)

Cada timeframe consulta la tabla archive correspondiente. Requiere diseño especial por el volumen de datos.

### Precios USD

Para conversión a USD en la columna "TOTAL USD". Determinar fuente de precios.

---

## UI - Dashboard

### Chain Statistics

- Validadores activos totales
- Total staked
- Validadores entrando a la chain
- Validadores saliendo de la chain
- Validadores consolidando

### User Cluster

- Dropdown para seleccionar cluster o "All"
- CRUD de clusters
- Agregar/quitar validadores

### Performance Summary

- **Validadores por estado**: estado blockchain + estado derivado "inactivo"
- **Balance y effective balance**: suma de todos los validadores del cluster
- **Performance 1h/1d/1w/1m**: ratio de attestations on time

### Performance Table

| Period | APY% | Consensus | Missed Rewards | Execution | Total USD |
| ------ | ---- | --------- | -------------- | --------- | --------- |
| 1h     | X%   | X GWei    | X GWei         | X GWei    | $X        |
| 1d     | X%   | X GWei    | X GWei         | X GWei    | $X        |
| 1w     | X%   | X GWei    | X GWei         | X GWei    | $X        |
| 1m     | X%   | X GWei    | X GWei         | X GWei    | $X        |

### Events

- Blocks propuestos
- Deposits
- Withdrawals
- Consolidations
- Incidents (cuando un cluster tiene validadores inactivos)

---

## UI - Validator Page

Similar al dashboard pero para un solo validador:

- Performance y rewards individuales
- Historial de eventos
- Estado actual y derivado

---

## Principios de Desarrollo

### Tareas atómicas

- Cada tarea tiene su propio PR.
- Si involucra múltiples capas (indexer, API, UI), PRs separados por capa.
- Cada PR incluye tests.

### AGENTS.md

- Cada tarea debe actualizar AGENTS.md si aporta conocimiento relevante.
- Objetivo: en el futuro poder pedir features/bugfixes sin explicar cómo funcionan las cosas.
- Solo describir el feature/problema, el agente tiene contexto suficiente.

### Performance

- Raw SQL para queries críticas.
- Minimizar espacio en disco (patrón de archive tables).
- Particionamiento para tablas grandes.

### Consistencia

- camelCase para modelos Prisma.
- snake_case para nombres de tablas (via `@@map`).
- Transacciones atómicas para operaciones que modifican múltiples tablas.

---

## Notas Técnicas

### Tokens por Chain

- **Mainnet**: Consensus rewards en ETH, Execution rewards en ETH
- **Gnosis**: Consensus rewards en GNO, Execution rewards en DAI

### Cálculo de APY

```
APY = (rewards_del_periodo / balance) * periodos_por_año
```

Fórmula simple anualizada, sin compound.

### maxAttestationDelay

Definido en `packages/beacon-utils/src/config/chain.ts`. Una attestation con delay mayor se considera "missed".

### missedAttestationsForInactivity

Definido en `packages/beacon-utils/src/config/chain.ts`. Cantidad de attestations consecutivas perdidas para considerar un validador "inactivo".
