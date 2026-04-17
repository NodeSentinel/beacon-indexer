import { Prisma, PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

type ListClusterIncidentsParams = {
  ownerId: string;
  clusterId: string;
  page: number;
  pageSize: number;
};

type MarkOpenIncidentNotifiedParams = {
  ownerId: string;
  clusterId: string;
  notifiedAt: Date;
};

type MarkClosedIncidentNotifiedParams = {
  ownerId: string;
  incidentId: string;
  notifiedAt: Date;
};

type ListIncidentAffectedValidatorsParams = {
  ownerId: string;
  incidentId: string;
  page: number;
  pageSize: number;
};

/**
 * Reads and updates cluster incidents using ownership-scoped queries.
 */
export class IncidentStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Confirms the cluster belongs to the authenticated user.
   */
  async isOwnedCluster(params: { ownerId: string; clusterId: string }): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1
        FROM cluster
        WHERE id = ${params.clusterId}
          AND owner_id = ${params.ownerId}
      ) AS "exists"
    `;

    return row?.exists ?? false;
  }

  /**
   * Confirms the incident belongs to a cluster owned by the authenticated user.
   */
  async isOwnedIncident(params: { ownerId: string; incidentId: string }): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1
        FROM cluster_incident incident
        JOIN cluster ON cluster.id = incident.cluster_id
        WHERE incident.id = ${params.incidentId}::uuid
          AND cluster.owner_id = ${params.ownerId}
      ) AS "exists"
    `;

    return row?.exists ?? false;
  }

  /**
   * Lists cluster incidents with ownership and pagination applied in SQL.
   */
  async listClusterIncidents(params: ListClusterIncidentsParams) {
    const offset = (params.page - 1) * params.pageSize;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: 'open' | 'closed';
        opened_at: Date;
        opened_slot: number;
        closed_at: Date | null;
        closed_slot: number | null;
        duration_slots: number | null;
        duration_seconds: number | null;
        missed_attestation_rewards: bigint | null;
        missed_sync_rewards: bigint | null;
        missed_consensus_rewards: bigint | null;
        rewards_finalized: boolean;
        rewards_finalized_at: Date | null;
        opened_notification_queued_at: Date | null;
        closed_notification_queued_at: Date | null;
        total_count: bigint;
      }>
    >(Prisma.sql`
      SELECT
        incident.id,
        incident.status::text AS status,
        incident.opened_at,
        incident.opened_slot,
        incident.closed_at,
        incident.closed_slot,
        incident.duration_slots,
        incident.duration_seconds,
        incident.missed_attestation_rewards,
        incident.missed_sync_rewards,
        incident.missed_consensus_rewards,
        incident.rewards_finalized,
        incident.rewards_finalized_at,
        incident.opened_notification_queued_at,
        incident.closed_notification_queued_at,
        COUNT(*) OVER()::bigint AS total_count
      FROM cluster_incident AS incident
      JOIN cluster ON cluster.id = incident.cluster_id
      WHERE incident.cluster_id = ${params.clusterId}
        AND cluster.owner_id = ${params.ownerId}
      ORDER BY incident.opened_at DESC, incident.id DESC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `);

    if (rows.length === 0) {
      return {
        rows,
        totalCount: 0,
      };
    }

    return {
      rows,
      totalCount: Number(rows[0].total_count),
    };
  }

  /**
   * Updates the latest open-notified timestamp for the current open incident.
   */
  async markOpenIncidentNotified(params: MarkOpenIncidentNotifiedParams) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        incident_id: string;
        opened_notification_queued_at: Date;
      }>
    >(Prisma.sql`
      UPDATE cluster_incident AS incident
      SET
        opened_notification_queued_at = ${params.notifiedAt},
        updated_at = ${params.notifiedAt}
      FROM cluster
      WHERE cluster.id = incident.cluster_id
        AND cluster.id = ${params.clusterId}
        AND cluster.owner_id = ${params.ownerId}
        AND incident.status = 'open'::"ClusterIncidentStatus"
      RETURNING incident.id AS incident_id, incident.opened_notification_queued_at
    `);

    return rows[0] ?? null;
  }

  /**
   * Reads the current status for an owned incident.
   */
  async getOwnedIncidentStatus(params: { ownerId: string; incidentId: string }) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        status: 'open' | 'closed';
      }>
    >(Prisma.sql`
      SELECT incident.status::text AS status
      FROM cluster_incident AS incident
      JOIN cluster ON cluster.id = incident.cluster_id
      WHERE incident.id = ${params.incidentId}::uuid
        AND cluster.owner_id = ${params.ownerId}
    `);

    return rows[0] ?? null;
  }

  /**
   * Updates the latest closed-notified timestamp for a closed incident.
   */
  async markClosedIncidentNotified(params: MarkClosedIncidentNotifiedParams) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        incident_id: string;
        closed_notification_queued_at: Date;
      }>
    >(Prisma.sql`
      UPDATE cluster_incident AS incident
      SET
        closed_notification_queued_at = ${params.notifiedAt},
        updated_at = ${params.notifiedAt}
      FROM cluster
      WHERE cluster.id = incident.cluster_id
        AND incident.id = ${params.incidentId}::uuid
        AND cluster.owner_id = ${params.ownerId}
        AND incident.status = 'closed'::"ClusterIncidentStatus"
      RETURNING incident.id AS incident_id, incident.closed_notification_queued_at
    `);

    return rows[0] ?? null;
  }

  /**
   * Lists incident validators with ownership and pagination applied in SQL.
   */
  async listIncidentAffectedValidators(params: ListIncidentAffectedValidatorsParams) {
    const offset = (params.page - 1) * params.pageSize;

    const rows = await this.prisma.$queryRaw<
      Array<{
        validator_index: number;
        inactive_from_slot: number;
        inactive_to_slot: number | null;
        rewards_processed_through_slot: number | null;
        missed_attestation_rewards: bigint;
        missed_sync_rewards: bigint;
        missed_consensus_rewards: bigint;
        total_count: bigint;
      }>
    >(Prisma.sql`
      SELECT
        incident_validator.validator_index,
        incident_validator.inactive_from_slot,
        incident_validator.inactive_to_slot,
        incident_validator.rewards_processed_through_slot,
        incident_validator.missed_attestation_rewards,
        incident_validator.missed_sync_rewards,
        incident_validator.missed_consensus_rewards,
        COUNT(*) OVER()::bigint AS total_count
      FROM cluster_incident_validator AS incident_validator
      JOIN cluster_incident AS incident ON incident.id = incident_validator.incident_id
      JOIN cluster ON cluster.id = incident.cluster_id
      WHERE incident.id = ${params.incidentId}::uuid
        AND cluster.owner_id = ${params.ownerId}
      ORDER BY incident_validator.validator_index ASC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `);

    if (rows.length === 0) {
      return {
        rows,
        totalCount: 0,
      };
    }

    return {
      rows,
      totalCount: Number(rows[0].total_count),
    };
  }
}
