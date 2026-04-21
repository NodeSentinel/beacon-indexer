import { ClusterIncidentStatus, Prisma, PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';
import { formatBalance } from '@/utils/tokenFormat.js';

type IncidentNotificationType = 'incident_opened' | 'incident_closed';

type DueIncidentNotificationRow = {
  incident_id: string;
  cluster_id: string;
  cluster_name: string;
  owner_id: string;
  telegram_id: bigint;
  type: IncidentNotificationType;
  due_at: Date;
  opened_at: Date;
  opened_slot: number;
  closed_at: Date | null;
  closed_slot: number | null;
  duration_seconds: number | null;
  duration_slots: number | null;
  missed_consensus_rewards: bigint | null;
  validator_indexes: number[] | null;
};

const INCIDENT_NOTIFICATION_PREFIX = 'incident-notification';
const OPEN_INCIDENT_REPEAT_MS = 3 * 60 * 60 * 1000;

/** Builds a synthetic notification id for an incident notification. */
export function getIncidentNotificationId(
  type: IncidentNotificationType,
  incidentId: string,
): string {
  return `${INCIDENT_NOTIFICATION_PREFIX}:${type}:${incidentId}`;
}

/** Parses a synthetic incident notification id. */
export function parseIncidentNotificationId(
  id: string,
): { incidentId: string; type: IncidentNotificationType } | null {
  const [prefix, type, incidentId] = id.split(':');

  if (
    prefix !== INCIDENT_NOTIFICATION_PREFIX ||
    (type !== 'incident_opened' && type !== 'incident_closed') ||
    !incidentId
  ) {
    return null;
  }

  return { incidentId, type };
}

/** Builds the Telegram payload for an incident notification. */
function getIncidentNotificationPayload(row: DueIncidentNotificationRow) {
  return {
    incidentId: row.incident_id,
    clusterId: row.cluster_id,
    clusterName: row.cluster_name,
    openedAt: row.opened_at.toISOString(),
    openedSlot: row.opened_slot,
    closedAt: row.closed_at?.toISOString(),
    closedSlot: row.closed_slot,
    durationSeconds: row.duration_seconds,
    durationSlots: row.duration_slots,
    missedConsensusRewards: {
      token: formatBalance(row.missed_consensus_rewards),
      wei: row.missed_consensus_rewards?.toString() ?? '0',
    },
    validatorIndexes: row.validator_indexes ?? [],
  };
}

export class BotNotificationsStorage {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Lists queued notifications and synthetic due incident notifications. */
  async listPending(limit: number) {
    const [queuedNotifications, incidentNotifications] = await Promise.all([
      this.prisma.notificationQueue.findMany({
        where: {
          delivered: false,
          user: {
            telegramId: { not: null },
            hasBlockedBot: false,
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          id: true,
          userId: true,
          type: true,
          payload: true,
          createdAt: true,
          user: {
            select: {
              telegramId: true,
            },
          },
        },
      }),
      this.listPendingIncidentNotifications(limit),
    ]);

    return [...queuedNotifications, ...incidentNotifications]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit);
  }

  /** Lists incident notifications due for bot delivery. */
  private async listPendingIncidentNotifications(limit: number) {
    const repeatAfter = new Date(Date.now() - OPEN_INCIDENT_REPEAT_MS);
    const rows = await this.prisma.$queryRaw<DueIncidentNotificationRow[]>(Prisma.sql`
      WITH incident_validator_indexes AS (
        SELECT
          incident_id,
          ARRAY_AGG(DISTINCT validator_index ORDER BY validator_index) AS validator_indexes
        FROM cluster_incident_validator
        GROUP BY incident_id
      ),
      due_incidents AS (
        SELECT
          incident.id AS incident_id,
          incident.cluster_id,
          cluster.name AS cluster_name,
          cluster.owner_id,
          owner.telegram_id,
          'incident_opened'::text AS type,
          COALESCE(incident.opened_notification_queued_at, incident.opened_at) AS due_at,
          incident.opened_at,
          incident.opened_slot,
          incident.closed_at,
          incident.closed_slot,
          incident.duration_seconds,
          incident.duration_slots,
          incident.missed_consensus_rewards,
          incident_validator_indexes.validator_indexes
        FROM cluster_incident AS incident
        JOIN cluster ON cluster.id = incident.cluster_id
        JOIN "user" AS owner ON owner.id = cluster.owner_id
        LEFT JOIN incident_validator_indexes ON incident_validator_indexes.incident_id = incident.id
        WHERE incident.status = 'open'::"ClusterIncidentStatus"
          AND owner.telegram_id IS NOT NULL
          AND owner.has_blocked_bot = FALSE
          AND (
            incident.opened_notification_queued_at IS NULL
            OR incident.opened_notification_queued_at <= ${repeatAfter}
          )

        UNION ALL

        SELECT
          incident.id AS incident_id,
          incident.cluster_id,
          cluster.name AS cluster_name,
          cluster.owner_id,
          owner.telegram_id,
          'incident_closed'::text AS type,
          COALESCE(incident.closed_at, incident.updated_at) AS due_at,
          incident.opened_at,
          incident.opened_slot,
          incident.closed_at,
          incident.closed_slot,
          incident.duration_seconds,
          incident.duration_slots,
          incident.missed_consensus_rewards,
          incident_validator_indexes.validator_indexes
        FROM cluster_incident AS incident
        JOIN cluster ON cluster.id = incident.cluster_id
        JOIN "user" AS owner ON owner.id = cluster.owner_id
        LEFT JOIN incident_validator_indexes ON incident_validator_indexes.incident_id = incident.id
        WHERE incident.status = 'closed'::"ClusterIncidentStatus"
          AND owner.telegram_id IS NOT NULL
          AND owner.has_blocked_bot = FALSE
          AND incident.closed_notification_queued_at IS NULL
      )
      SELECT *
      FROM due_incidents
      ORDER BY due_at ASC, incident_id ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: getIncidentNotificationId(row.type, row.incident_id),
      userId: row.owner_id,
      type: row.type,
      payload: getIncidentNotificationPayload(row),
      createdAt: row.due_at,
      user: {
        telegramId: row.telegram_id,
      },
    }));
  }

  /** Marks a regular or synthetic notification as delivered. */
  async markDelivered(id: string) {
    const incidentNotification = parseIncidentNotificationId(id);

    if (incidentNotification) {
      return this.markIncidentNotificationDelivered(incidentNotification);
    }

    return this.prisma.notificationQueue.update({
      where: { id },
      data: {
        delivered: true,
        deliveredAt: new Date(),
      },
    });
  }

  /** Marks a synthetic incident notification as delivered. */
  private async markIncidentNotificationDelivered(params: {
    incidentId: string;
    type: IncidentNotificationType;
  }) {
    const deliveredAt = new Date();

    if (params.type === 'incident_opened') {
      return this.prisma.clusterIncident.updateMany({
        where: {
          id: params.incidentId,
          status: ClusterIncidentStatus.open,
        },
        data: {
          openedNotificationQueuedAt: deliveredAt,
          updatedAt: deliveredAt,
        },
      });
    }

    return this.prisma.clusterIncident.updateMany({
      where: {
        id: params.incidentId,
        status: ClusterIncidentStatus.closed,
      },
      data: {
        closedNotificationQueuedAt: deliveredAt,
        updatedAt: deliveredAt,
      },
    });
  }

  /** Deletes a regular queued notification. */
  async delete(id: string) {
    return this.prisma.notificationQueue.delete({
      where: { id },
    });
  }
}
