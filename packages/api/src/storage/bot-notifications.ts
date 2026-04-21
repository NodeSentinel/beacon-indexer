import { ClusterIncidentStatus, Prisma, PrismaClient } from '@beacon-indexer/db';

import { getPrisma } from '@/lib/prisma.js';

type IncidentNotificationType = 'incident_opened' | 'incident_closed';

const incidentNotificationSelect = {
  id: true,
  clusterId: true,
  status: true,
  openedAt: true,
  openedSlot: true,
  openedNotificationQueuedAt: true,
  closedAt: true,
  closedSlot: true,
  updatedAt: true,
  cluster: {
    select: {
      name: true,
      ownerId: true,
      owner: {
        select: {
          telegramId: true,
        },
      },
    },
  },
} satisfies Prisma.ClusterIncidentSelect;

type DueIncidentNotification = Prisma.ClusterIncidentGetPayload<{
  select: typeof incidentNotificationSelect;
}>;

type IncidentNotification = {
  id: string;
  incidentNotificationType: IncidentNotificationType;
  userId: string;
  type: IncidentNotificationType;
  payload: ReturnType<typeof getIncidentNotificationPayload>;
  createdAt: Date;
  user: {
    telegramId: bigint;
  };
};

const OPEN_INCIDENT_REPEAT_MS = 3 * 60 * 60 * 1000;

/** Builds the Telegram payload for an incident notification. */
function getIncidentNotificationPayload(incident: DueIncidentNotification) {
  return {
    incidentId: incident.id,
    clusterId: incident.clusterId,
    clusterName: incident.cluster.name,
    openedAt: incident.openedAt.toISOString(),
    openedSlot: incident.openedSlot,
    closedAt: incident.closedAt?.toISOString(),
    closedSlot: incident.closedSlot,
    isReminder:
      incident.status === ClusterIncidentStatus.open &&
      incident.openedNotificationQueuedAt !== null,
  };
}

/** Gets the notification type for an incident row. */
function getIncidentNotificationType(incident: DueIncidentNotification): IncidentNotificationType {
  return incident.status === ClusterIncidentStatus.closed ? 'incident_closed' : 'incident_opened';
}

/** Gets the timestamp used to interleave incident notifications with queued notifications. */
function getIncidentNotificationCreatedAt(incident: DueIncidentNotification): Date {
  if (incident.status === ClusterIncidentStatus.closed) {
    return incident.closedAt ?? incident.updatedAt;
  }

  return incident.openedNotificationQueuedAt ?? incident.openedAt;
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
  private async listPendingIncidentNotifications(limit: number): Promise<IncidentNotification[]> {
    const repeatAfter = new Date(Date.now() - OPEN_INCIDENT_REPEAT_MS);

    const incidents = await this.prisma.clusterIncident.findMany({
      where: {
        cluster: {
          owner: {
            telegramId: { not: null },
            hasBlockedBot: false,
          },
        },
        OR: [
          {
            status: ClusterIncidentStatus.open,
            OR: [
              { openedNotificationQueuedAt: null },
              { openedNotificationQueuedAt: { lte: repeatAfter } },
            ],
          },
          {
            status: ClusterIncidentStatus.closed,
            closedNotificationQueuedAt: null,
          },
        ],
      },
      select: incidentNotificationSelect,
    });

    return incidents
      .map((incident) => {
        const type = getIncidentNotificationType(incident);

        return {
          id: incident.id,
          incidentNotificationType: type,
          userId: incident.cluster.ownerId,
          type,
          payload: getIncidentNotificationPayload(incident),
          createdAt: getIncidentNotificationCreatedAt(incident),
          user: {
            telegramId: incident.cluster.owner.telegramId!,
          },
        };
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit);
  }

  /** Marks a regular or synthetic notification as delivered. */
  async markDelivered(params: {
    id: string;
    incidentNotificationType?: IncidentNotificationType | null;
  }) {
    if (params.incidentNotificationType) {
      return this.markIncidentNotificationDelivered({
        incidentId: params.id,
        type: params.incidentNotificationType,
      });
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
