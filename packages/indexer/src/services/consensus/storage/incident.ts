import { PrismaClient } from '@beacon-indexer/db';

type ClusterIncidentStateRow = {
  cluster_id: string;
  cluster_name: string;
  owner_id: string;
  inactive_validator_indexes: number[];
};

type OpenIncidentRow = {
  id: string;
  cluster_id: string;
  opened_at: Date;
  opened_slot: number;
  opened_validator_indexes: number[];
  current_validator_indexes: number[];
  affected_validator_indexes: number[];
};

type IncidentSummaryRow = {
  missed_attestations: bigint | null;
  missed_consensus_rewards: bigint | null;
};

export class IncidentStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async listCurrentClusterStates(): Promise<ClusterIncidentStateRow[]> {
    return this.prisma.$queryRaw<ClusterIncidentStateRow[]>`
      SELECT
        c.id AS cluster_id,
        c.name AS cluster_name,
        c.owner_id,
        COALESCE(
          ARRAY_AGG(vss.validator_index ORDER BY vss.validator_index)
            FILTER (
              WHERE vss.is_inactive = true
                AND COALESCE(vss.beacon_status, 0) IN (0, 1, 2, 3, 4)
            ),
          ARRAY[]::int[]
        ) AS inactive_validator_indexes
      FROM cluster c
      LEFT JOIN cluster_validator cv ON cv.cluster_id = c.id
      LEFT JOIN validators_snapshot_stats vss ON vss.validator_index = cv.validator_index
      GROUP BY c.id, c.name, c.owner_id
    `;
  }

  async listOpenIncidents(): Promise<OpenIncidentRow[]> {
    return this.prisma.$queryRaw<OpenIncidentRow[]>`
      SELECT
        ci.id,
        ci.cluster_id,
        ci.opened_at,
        ci.opened_slot,
        ci.opened_validator_indexes,
        ci.current_validator_indexes,
        ci.affected_validator_indexes
      FROM cluster_incident ci
      WHERE ci.status = 'open'::"public"."ClusterIncidentStatus"
    `;
  }

  async createIncident(params: {
    clusterId: string;
    ownerId: string;
    clusterName: string;
    openedAt: Date;
    openedSlot: number;
    validatorIndexes: number[];
  }) {
    const { clusterId, ownerId, clusterName, openedAt, openedSlot, validatorIndexes } = params;

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.clusterIncident.create({
        data: {
          clusterId,
          openedAt,
          openedSlot,
          openedValidatorIndexes: validatorIndexes,
          currentValidatorIndexes: validatorIndexes,
          affectedValidatorIndexes: validatorIndexes,
        },
      });

      const owner = await tx.user.findUnique({
        where: { id: ownerId },
        select: { hasBlockedBot: true, telegramId: true },
      });

      if (owner?.telegramId && !owner.hasBlockedBot) {
        await tx.notificationQueue.create({
          data: {
            userId: ownerId,
            type: 'incident_opened',
            payload: {
              clusterId,
              clusterName,
              incidentId: incident.id,
              openedAt: openedAt.toISOString(),
              openedSlot,
              validatorIndexes,
            },
          },
        });

        await tx.clusterIncident.update({
          where: { id: incident.id },
          data: { openedNotificationQueuedAt: new Date(), updatedAt: new Date() },
        });
      }

      return incident;
    });
  }

  async updateIncidentValidators(params: {
    incidentId: string;
    currentValidatorIndexes: number[];
    affectedValidatorIndexes: number[];
  }): Promise<void> {
    await this.prisma.clusterIncident.update({
      where: { id: params.incidentId },
      data: {
        currentValidatorIndexes: params.currentValidatorIndexes,
        affectedValidatorIndexes: params.affectedValidatorIndexes,
        updatedAt: new Date(),
      },
    });
  }

  async closeIncident(params: {
    incidentId: string;
    ownerId: string;
    clusterId: string;
    clusterName: string;
    closedAt: Date;
    closedSlot: number;
    durationSlots: number;
    durationSeconds: number;
    missedAttestations: number;
    missedConsensusRewards: bigint;
    affectedValidatorIndexes: number[];
  }): Promise<void> {
    const {
      incidentId,
      ownerId,
      clusterId,
      clusterName,
      closedAt,
      closedSlot,
      durationSlots,
      durationSeconds,
      missedAttestations,
      missedConsensusRewards,
      affectedValidatorIndexes,
    } = params;

    await this.prisma.$transaction(async (tx) => {
      await tx.clusterIncident.update({
        where: { id: incidentId },
        data: {
          status: 'closed',
          closedAt,
          closedSlot,
          currentValidatorIndexes: [],
          durationSlots,
          durationSeconds,
          missedAttestations,
          missedConsensusRewards,
          updatedAt: new Date(),
        },
      });

      const owner = await tx.user.findUnique({
        where: { id: ownerId },
        select: { hasBlockedBot: true, telegramId: true },
      });

      if (owner?.telegramId && !owner.hasBlockedBot) {
        await tx.notificationQueue.create({
          data: {
            userId: ownerId,
            type: 'incident_closed',
            payload: {
              clusterId,
              clusterName,
              incidentId,
              closedAt: closedAt.toISOString(),
              closedSlot,
              durationSeconds,
              durationSlots,
              missedAttestations,
              missedConsensusRewards: missedConsensusRewards.toString(),
              validatorIndexes: affectedValidatorIndexes,
            },
          },
        });

        await tx.clusterIncident.update({
          where: { id: incidentId },
          data: { closedNotificationQueuedAt: new Date(), updatedAt: new Date() },
        });
      }
    });
  }

  async computeIncidentSummary(params: {
    fromSlot: number;
    toSlot: number;
    fromEpoch: number;
    toEpoch: number;
    validatorIndexes: number[];
    maxAttestationDelay: number;
  }): Promise<{ missedAttestations: number; missedConsensusRewards: bigint }> {
    const { fromSlot, toSlot, fromEpoch, toEpoch, validatorIndexes, maxAttestationDelay } = params;

    const rows = await this.prisma.$queryRaw<IncidentSummaryRow[]>`
      WITH
        daily_slot_misses AS (
          SELECT COUNT(*)::bigint AS missed_attestations
          FROM validator_daily_archive vda,
          LATERAL jsonb_array_elements(COALESCE(vda.data_by_slot, '[]'::jsonb)) AS slot_row
          WHERE vda.validator_index = ANY(${validatorIndexes}::int[])
            AND (slot_row->>0)::int BETWEEN ${fromSlot}::int AND ${toSlot}::int
            AND (
              (slot_row->>1)::int = -1
              OR (slot_row->>1)::int > ${maxAttestationDelay}::int
            )
        ),
        hourly_slot_misses AS (
          SELECT COUNT(*)::bigint AS missed_attestations
          FROM validator_hourly_archive vha,
          LATERAL jsonb_array_elements(vha.data_by_slot) AS slot_row
          WHERE vha.validator_index = ANY(${validatorIndexes}::int[])
            AND (slot_row->>0)::int BETWEEN ${fromSlot}::int AND ${toSlot}::int
            AND (
              (slot_row->>1)::int = -1
              OR (slot_row->>1)::int > ${maxAttestationDelay}::int
            )
        ),
        raw_slot_misses AS (
          SELECT COUNT(*)::bigint AS missed_attestations
          FROM committee c
          WHERE c.validator_index = ANY(${validatorIndexes}::int[])
            AND c.slot BETWEEN ${fromSlot}::int AND ${toSlot}::int
            AND (
              c.attestation_delay IS NULL
              OR c.attestation_delay > ${maxAttestationDelay}::int
            )
        ),
        daily_epoch_misses AS (
          SELECT
            COALESCE(
              SUM(
                COALESCE((epoch_row->>5)::bigint, 0)
                + COALESCE((epoch_row->>6)::bigint, 0)
                + COALESCE((epoch_row->>7)::bigint, 0)
                + COALESCE((epoch_row->>8)::bigint, 0)
              ),
              0
            ) AS missed_consensus_rewards
          FROM validator_daily_archive vda,
          LATERAL jsonb_array_elements(COALESCE(vda.data_by_epoch, '[]'::jsonb)) AS epoch_row
          WHERE vda.validator_index = ANY(${validatorIndexes}::int[])
            AND (epoch_row->>0)::int BETWEEN ${fromEpoch}::int AND ${toEpoch}::int
        ),
        hourly_epoch_misses AS (
          SELECT
            COALESCE(
              SUM(
                COALESCE((epoch_row->>5)::bigint, 0)
                + COALESCE((epoch_row->>6)::bigint, 0)
                + COALESCE((epoch_row->>7)::bigint, 0)
                + COALESCE((epoch_row->>8)::bigint, 0)
              ),
              0
            ) AS missed_consensus_rewards
          FROM validator_hourly_archive vha,
          LATERAL jsonb_array_elements(vha.data_by_epoch) AS epoch_row
          WHERE vha.validator_index = ANY(${validatorIndexes}::int[])
            AND (epoch_row->>0)::int BETWEEN ${fromEpoch}::int AND ${toEpoch}::int
        ),
        raw_epoch_misses AS (
          SELECT
            COALESCE(
              SUM(
                er.missed_head
                + er.missed_target
                + er.missed_source
                + er.missed_inactivity
              ),
              0
            ) AS missed_consensus_rewards
          FROM epoch_rewards er
          WHERE er.validator_index = ANY(${validatorIndexes}::int[])
            AND er.epoch BETWEEN ${fromEpoch}::int AND ${toEpoch}::int
        )
      SELECT
        (
          COALESCE((SELECT missed_attestations FROM daily_slot_misses), 0)
          + COALESCE((SELECT missed_attestations FROM hourly_slot_misses), 0)
          + COALESCE((SELECT missed_attestations FROM raw_slot_misses), 0)
        )::bigint AS missed_attestations,
        (
          COALESCE((SELECT missed_consensus_rewards FROM daily_epoch_misses), 0)
          + COALESCE((SELECT missed_consensus_rewards FROM hourly_epoch_misses), 0)
          + COALESCE((SELECT missed_consensus_rewards FROM raw_epoch_misses), 0)
        )::bigint AS missed_consensus_rewards
    `;

    const row = rows[0];

    return {
      missedAttestations: Number(row?.missed_attestations ?? BigInt(0)),
      missedConsensusRewards: row?.missed_consensus_rewards ?? BigInt(0),
    };
  }
}
