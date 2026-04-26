import { ClusterIncidentStatus, Prisma, PrismaClient } from '@beacon-indexer/db';

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

/** Gets the bot notification type for an incident row. */
function getIncidentNotificationType(incident: DueIncidentNotification): IncidentNotificationType {
  return incident.status === ClusterIncidentStatus.closed ? 'incident_closed' : 'incident_opened';
}

/** Gets the timestamp used for incident notification ordering. */
function getIncidentNotificationCreatedAt(incident: DueIncidentNotification): Date {
  if (incident.status === ClusterIncidentStatus.closed) {
    return incident.closedAt ?? incident.updatedAt;
  }

  return incident.openedNotificationQueuedAt ?? incident.openedAt;
}

export class BotIncidentNotificationsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /** Lists cluster incident notifications due for bot delivery. */
  async listPending(limit: number) {
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

  /** Marks an open incident notification as sent. */
  async markOpenedNotified(incidentId: string) {
    const deliveredAt = new Date();

    return this.prisma.clusterIncident.updateMany({
      where: {
        id: incidentId,
        status: ClusterIncidentStatus.open,
      },
      data: {
        openedNotificationQueuedAt: deliveredAt,
        updatedAt: deliveredAt,
      },
    });
  }

  /** Marks a closed incident notification as sent. */
  async markClosedNotified(incidentId: string) {
    const deliveredAt = new Date();

    return this.prisma.clusterIncident.updateMany({
      where: {
        id: incidentId,
        status: ClusterIncidentStatus.closed,
      },
      data: {
        closedNotificationQueuedAt: deliveredAt,
        updatedAt: deliveredAt,
      },
    });
  }
}
