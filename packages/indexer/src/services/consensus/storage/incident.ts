import { Prisma, PrismaClient } from '@beacon-indexer/db';

export class IncidentStorage {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainTiming: {
      genesisTimeSec: number;
      secPerSlot: number;
      slotsPerEpoch: number;
    },
  ) {}

  private getSlotDate(slot: number | bigint): Date {
    // Convert a consensus slot into a wall-clock timestamp using the configured
    // genesis time and slot duration for the active chain.
    const normalizedSlot = Number(slot);
    return new Date(
      this.chainTiming.genesisTimeSec * 1000 + normalizedSlot * this.chainTiming.secPerSlot * 1000,
    );
  }

  private getSqlTimestampForExpression(slotExpression: Prisma.Sql): Prisma.Sql {
    // Reproduce the same slot -> timestamp mapping the JS helpers use, but let
    // SQL provide the slot expression so set-based incident reconciliation can
    // derive opened/updated/closed timestamps per cluster row.
    return Prisma.sql`
      TIMESTAMP 'epoch' + (
        (${this.chainTiming.genesisTimeSec}::bigint + (${slotExpression})::bigint * ${this.chainTiming.secPerSlot}::bigint) *
        INTERVAL '1 second'
      )
    `;
  }

  async openIncidentIfMissing(
    tx: Prisma.TransactionClient,
    params: { clusterId: string; openedSlot: number; validatorIndexes: number[] },
  ) {
    const openedSlot = Number(params.openedSlot);
    // Normalize validator membership so the persisted incident payload stays
    // deterministic even if callers pass duplicates or unsorted indexes.
    const validatorIndexes = [
      ...new Set(params.validatorIndexes.map((validatorIndex) => Number(validatorIndex))),
    ].sort((a, b) => a - b);
    const existing = await tx.clusterIncident.findFirst({
      where: {
        clusterId: params.clusterId,
        status: 'open',
      },
    });

    // Reuse the existing open incident for the cluster when one already exists,
    // widening the validator set only when new inactive validators joined it.
    if (existing) {
      const mergedValidatorIndexes = [
        ...new Set([...existing.validatorIndexes, ...validatorIndexes]),
      ].sort((a, b) => a - b);

      if (JSON.stringify(existing.validatorIndexes) === JSON.stringify(mergedValidatorIndexes)) {
        return existing;
      }

      return tx.clusterIncident.update({
        where: { id: existing.id },
        data: {
          validatorIndexes: mergedValidatorIndexes,
          updatedAt: this.getSlotDate(openedSlot),
        },
      });
    }

    const openedAt = this.getSlotDate(openedSlot);

    const incident = await tx.clusterIncident.create({
      data: {
        clusterId: params.clusterId,
        status: 'open',
        openedAt,
        openedSlot,
        validatorIndexes,
        updatedAt: openedAt,
      },
    });

    return incident;
  }

  async reconcileOpenIncidents(tx: Prisma.TransactionClient, params: { processedSlot: number }) {
    const processedSlot = Number(params.processedSlot);
    const processedSlotTimestamp = this.getSqlTimestampForExpression(
      Prisma.sql`${processedSlot}::int`,
    );

    // Compare two durable states only:
    // 1. the clusters that currently have registered validators marked inactive,
    // 2. the clusters that currently have an open incident.
    // From that diff SQL can insert missing incidents, widen the cumulative
    // validator set when new validators join the incident, and close incidents
    // only when no validators in the cluster remain inactive.
    await tx.$executeRaw`
      WITH current_inactive_clusters AS (
        -- Read only registered validators that are currently inactive and group
        -- them into one ordered validator list per cluster.
        SELECT
          cv.cluster_id,
          MIN(vss.inactive_since_slot) AS first_inactive_slot,
          array_agg(DISTINCT cv.validator_index ORDER BY cv.validator_index) AS inactive_validator_indexes
        FROM cluster_validator cv
        JOIN validators_snapshot_stats vss ON vss.validator_index = cv.validator_index
        WHERE vss.is_inactive = TRUE
          AND vss.inactive_since_slot IS NOT NULL
        GROUP BY cv.cluster_id
      ),
      open_incidents AS (
        -- Read the currently open incident per cluster so reconciliation can
        -- diff the persisted validator set against the current inactive set.
        SELECT
          id,
          cluster_id,
          opened_at,
          opened_slot,
          validator_indexes
        FROM cluster_incident
        WHERE status = 'open'
      ),
      recomputed AS (
        -- Join the live inactive set with the currently open incidents. Every
        -- touched cluster now has both its previous incident state and its live
        -- inactive membership in one row.
        SELECT
          COALESCE(current_inactive_clusters.cluster_id, open_incidents.cluster_id) AS cluster_id,
          open_incidents.id AS open_incident_id,
          open_incidents.opened_at AS current_opened_at,
          open_incidents.opened_slot AS current_opened_slot,
          COALESCE(open_incidents.validator_indexes, ARRAY[]::int[]) AS current_validator_indexes,
          current_inactive_clusters.first_inactive_slot,
          COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[]) AS current_inactive_validator_indexes,
          cardinality(
            COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[])
          ) AS current_inactive_count,
          ARRAY(
            SELECT DISTINCT validator_index
            FROM unnest(
              COALESCE(open_incidents.validator_indexes, ARRAY[]::int[]) ||
              COALESCE(current_inactive_clusters.inactive_validator_indexes, ARRAY[]::int[])
            ) AS validator_index
            ORDER BY validator_index
          ) AS next_validator_indexes
        FROM current_inactive_clusters
        FULL OUTER JOIN open_incidents
          ON open_incidents.cluster_id = current_inactive_clusters.cluster_id
      ),
      to_insert AS (
        -- If a cluster has inactive validators but no open incident, create one
        -- backdated to the earliest inactive validator in the cluster.
        SELECT
          ('incident-' || md5(cluster_id || ':' || first_inactive_slot::text || ':' || txid_current()::text)) AS incident_id,
          cluster_id,
          first_inactive_slot,
          next_validator_indexes
        FROM recomputed
        WHERE open_incident_id IS NULL
          AND first_inactive_slot IS NOT NULL
          AND cardinality(next_validator_indexes) > 0
      ),
      inserted_incidents AS (
        INSERT INTO cluster_incident (
          id,
          status,
          cluster_id,
          opened_at,
          opened_slot,
          validator_indexes,
          updated_at
        )
        SELECT
          to_insert.incident_id,
          'open'::"ClusterIncidentStatus",
          to_insert.cluster_id,
          ${this.getSqlTimestampForExpression(Prisma.sql`to_insert.first_inactive_slot`)},
          to_insert.first_inactive_slot,
          to_insert.next_validator_indexes,
          ${processedSlotTimestamp}
        FROM to_insert
        RETURNING id
      ),
      updated_incidents AS (
        -- Open incidents widen their stored validator set when new inactive
        -- validators join the same incident later.
        UPDATE cluster_incident AS incident
        SET
          validator_indexes = recomputed.next_validator_indexes,
          updated_at = ${processedSlotTimestamp}
        FROM recomputed
        WHERE incident.id = recomputed.open_incident_id
          AND recomputed.current_inactive_count > 0
          AND recomputed.next_validator_indexes <> recomputed.current_validator_indexes
        RETURNING incident.id
      ),
      closed_incidents AS (
        -- Any open incident whose cluster no longer has inactive validators
        -- closes on the slot we just processed.
        UPDATE cluster_incident AS incident
        SET
          status = 'closed',
          closed_at = ${processedSlotTimestamp},
          closed_slot = ${processedSlot}::int,
          duration_slots = GREATEST(${processedSlot}::int - incident.opened_slot, 0),
          duration_seconds = GREATEST(
            FLOOR(EXTRACT(EPOCH FROM (${processedSlotTimestamp} - incident.opened_at)))::int,
            0
          ),
          updated_at = ${processedSlotTimestamp}
        FROM recomputed
        WHERE incident.id = recomputed.open_incident_id
          AND recomputed.current_inactive_count = 0
        RETURNING incident.id
      )
      SELECT 1
    `;
  }
}
