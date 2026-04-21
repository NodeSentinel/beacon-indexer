import { ClusterIncidentStatus, Prisma, PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

type IncidentNotificationType = 'incident_opened' | 'incident_closed';

type DueIncidentNotificationRow = {
  incident_id: string;
  cluster_id: string;
  cluster_name: string;
  owner_id: string;
  telegram_id: bigint;
  type: IncidentNotificationType;
  due_at: Date;
  notification_priority: number;
  opened_at: Date;
  opened_slot: number;
  closed_at: Date | null;
  closed_slot: number | null;
};

const OPEN_INCIDENT_REPEAT_MS = 3 * 60 * 60 * 1000;

/** Builds delivery metadata for an incident notification. */
export function getIncidentDeliveryTarget(
  incidentId: string,
  type: IncidentNotificationType,
): { incidentId: string; type: IncidentNotificationType } {
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
    isReminder: row.notification_priority > 0,
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

    const normalizedQueuedNotifications = queuedNotifications.map((notification) => ({
      ...notification,
      incidentNotificationType: null,
    }));

    return [...normalizedQueuedNotifications, ...incidentNotifications]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit);
  }

  /** Lists incident notifications due for bot delivery. */
  private async listPendingIncidentNotifications(limit: number) {
    const repeatAfter = new Date(Date.now() - OPEN_INCIDENT_REPEAT_MS);
    const rows = await this.prisma.$queryRaw<DueIncidentNotificationRow[]>(Prisma.sql`
      WITH due_incidents AS (
        SELECT
          incident.id AS incident_id,
          incident.cluster_id,
          cluster.name AS cluster_name,
          cluster.owner_id,
          owner.telegram_id,
          'incident_opened'::text AS type,
          COALESCE(incident.opened_notification_queued_at, incident.opened_at) AS due_at,
          CASE
            WHEN incident.opened_notification_queued_at IS NULL THEN 0
            ELSE 1
          END AS notification_priority,
          incident.opened_at,
          incident.opened_slot,
          incident.closed_at,
          incident.closed_slot
        FROM cluster_incident AS incident
        JOIN cluster ON cluster.id = incident.cluster_id
        JOIN "user" AS owner ON owner.id = cluster.owner_id
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
          0 AS notification_priority,
          incident.opened_at,
          incident.opened_slot,
          incident.closed_at,
          incident.closed_slot
        FROM cluster_incident AS incident
        JOIN cluster ON cluster.id = incident.cluster_id
        JOIN "user" AS owner ON owner.id = cluster.owner_id
        WHERE incident.status = 'closed'::"ClusterIncidentStatus"
          AND owner.telegram_id IS NOT NULL
          AND owner.has_blocked_bot = FALSE
          AND incident.closed_notification_queued_at IS NULL
      )
      SELECT *
      FROM due_incidents
      ORDER BY notification_priority ASC, due_at ASC, incident_id ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.incident_id,
      incidentNotificationType: row.type,
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
  async markDelivered(params: {
    id: string;
    incidentNotificationType?: IncidentNotificationType | null;
  }) {
    if (params.incidentNotificationType) {
      return this.markIncidentNotificationDelivered(
        getIncidentDeliveryTarget(params.id, params.incidentNotificationType),
      );
    }

    return this.prisma.notificationQueue.update({
      where: { id: params.id },
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
