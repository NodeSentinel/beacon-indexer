import type { Api, RawApi } from 'grammy';

import { getRpcClientForUser } from '@/src/api/client.js';
import type { Logger } from '@/src/logger.js';
import { formatStatsMessage } from '@/src/telegram/format-stats.js';
import { editMessage, sendMessage } from '@/src/telegram/messaging.js';

interface BotUser {
  id: string;
  telegramId: string;
  username: string;
  messageId: string | null;
}

/**
 * Fetch stats and send/edit a dashboard message for a single user.
 *
 * Flow:
 * 1. Set API client context to this user's telegramId
 * 2. Fetch cluster list → for each cluster, fetch snapshot
 * 3. Aggregate snapshots into a single message
 * 4. Edit existing message (if messageId exists) or send a new one
 * 5. Update messageId via API if it changed
 */
export async function notifyUserStats(
  api: Api<RawApi>,
  user: BotUser,
  logger: Logger,
): Promise<void> {
  const userLogger = logger.child({ telegramId: user.telegramId, username: user.username });
  const rpcClient = getRpcClientForUser(user.telegramId);

  // Fetch user's clusters
  userLogger.debug('Fetching clusters');
  const clustersResponse = await rpcClient.cluster.list({});
  if (!clustersResponse.success || !clustersResponse.data?.length) {
    userLogger.debug('No clusters found, skipping');
    return;
  }

  userLogger.debug({ clusterCount: clustersResponse.data.length }, 'Fetching snapshots');

  // Fetch snapshot for each cluster and aggregate
  const snapshots = await Promise.all(
    clustersResponse.data.map(async (cluster) => {
      const snapshotResponse = await rpcClient.cluster.snapshot({ id: cluster.id });
      if (!snapshotResponse.success || !snapshotResponse.data) return null;
      return snapshotResponse.data;
    }),
  );

  const validSnapshots = snapshots.filter((s) => s !== null);
  if (!validSnapshots.length) {
    userLogger.debug('No valid snapshots, skipping');
    return;
  }

  // Aggregate all snapshots into one
  const aggregated = aggregateSnapshots(validSnapshots);
  const message = formatStatsMessage(aggregated);

  const chatId = Number(user.telegramId);
  const existingMessageId = user.messageId ? Number(user.messageId) : null;

  userLogger.debug({ existingMessageId, message }, 'Sending dashboard message');

  // Try to edit existing message first
  if (existingMessageId) {
    const edited = await editMessage({
      api,
      chatId,
      messageId: existingMessageId,
      telegramId: user.telegramId,
      text: message,
      logger: userLogger,
      options: {
        parse_mode: 'MarkdownV2',
        link_preview_options: { is_disabled: true },
      },
    });
    if (edited) {
      userLogger.debug('Message edited successfully');
      return; // Message updated in place, messageId unchanged
    }
    // Edit failed (message deleted?), fall through to send new
    userLogger.debug('Edit failed, sending new message');
  }

  // Send new message
  const newMessageId = await sendMessage({
    api,
    chatId,
    telegramId: user.telegramId,
    text: message,
    logger: userLogger,
    options: {
      parse_mode: 'MarkdownV2',
      link_preview_options: { is_disabled: true },
      disable_notification: true,
    },
  });
  userLogger.debug({ newMessageId }, 'New message sent');

  // Update messageId if we got a new one
  if (newMessageId !== null && newMessageId !== existingMessageId) {
    try {
      await rpcClient.bot.updateMessageId({
        telegramId: user.telegramId,
        messageId: newMessageId,
      });
      userLogger.debug({ newMessageId }, 'messageId updated via API');
    } catch (err) {
      userLogger.error({ err, newMessageId }, 'Failed to update messageId via API');
    }
  }
}

interface SnapshotData {
  activeCount: number;
  inactiveCount: number;
  statusBreakdown: Record<string, number>;
  totalBalance: string;
  performanceH: number | null;
  performanceD: number | null;
  performanceW: number | null;
  performanceM: number | null;
  apyD: number | null;
  apyW: number | null;
  apyM: number | null;
  consensusRewardD: string | null;
  consensusRewardW: string | null;
  consensusRewardM: string | null;
  executionRewardD: { wei: string; token: string } | null;
  executionRewardW: { wei: string; token: string } | null;
  executionRewardM: { wei: string; token: string } | null;
  claimableRewards: string | null;
  tokenPrice: number;
}

/**
 * Aggregate multiple cluster snapshots into one combined snapshot.
 * Sums counts, balances, and rewards. Weighted average for performance and APY.
 */
function aggregateSnapshots(snapshots: SnapshotData[]): SnapshotData {
  if (snapshots.length === 1) return snapshots[0];

  let activeCount = 0;
  let inactiveCount = 0;
  const statusBreakdown: Record<string, number> = {};
  let totalBalance = 0;
  let tokenPrice = 0;

  // For weighted averages
  let perfHWeighted = 0,
    perfHCount = 0;
  let perfDWeighted = 0,
    perfDCount = 0;
  let perfWWeighted = 0,
    perfWCount = 0;
  let perfMWeighted = 0,
    perfMCount = 0;
  let apyDWeighted = 0,
    apyDCount = 0;
  let apyWWeighted = 0,
    apyWCount = 0;
  let apyMWeighted = 0,
    apyMCount = 0;

  let clRewardD = 0,
    clRewardW = 0,
    clRewardM = 0;
  let elRewardD = 0,
    elRewardW = 0,
    elRewardM = 0;
  let claimableRewards = 0;
  let hasClaimableRewards = false;

  for (const s of snapshots) {
    const validatorCount = s.activeCount + s.inactiveCount;
    activeCount += s.activeCount;
    inactiveCount += s.inactiveCount;
    for (const [status, count] of Object.entries(s.statusBreakdown)) {
      statusBreakdown[status] = (statusBreakdown[status] ?? 0) + count;
    }
    totalBalance += parseFloat(s.totalBalance);
    tokenPrice = s.tokenPrice; // same for all clusters

    if (s.performanceH !== null) {
      perfHWeighted += s.performanceH * validatorCount;
      perfHCount += validatorCount;
    }
    if (s.performanceD !== null) {
      perfDWeighted += s.performanceD * validatorCount;
      perfDCount += validatorCount;
    }
    if (s.performanceW !== null) {
      perfWWeighted += s.performanceW * validatorCount;
      perfWCount += validatorCount;
    }
    if (s.performanceM !== null) {
      perfMWeighted += s.performanceM * validatorCount;
      perfMCount += validatorCount;
    }
    if (s.apyD !== null) {
      apyDWeighted += s.apyD * validatorCount;
      apyDCount += validatorCount;
    }
    if (s.apyW !== null) {
      apyWWeighted += s.apyW * validatorCount;
      apyWCount += validatorCount;
    }
    if (s.apyM !== null) {
      apyMWeighted += s.apyM * validatorCount;
      apyMCount += validatorCount;
    }

    if (s.consensusRewardD) clRewardD += parseFloat(s.consensusRewardD);
    if (s.consensusRewardW) clRewardW += parseFloat(s.consensusRewardW);
    if (s.consensusRewardM) clRewardM += parseFloat(s.consensusRewardM);
    if (s.executionRewardD) elRewardD += parseFloat(s.executionRewardD.token);
    if (s.executionRewardW) elRewardW += parseFloat(s.executionRewardW.token);
    if (s.executionRewardM) elRewardM += parseFloat(s.executionRewardM.token);
    if (s.claimableRewards !== null) {
      claimableRewards += parseFloat(s.claimableRewards);
      hasClaimableRewards = true;
    }
  }

  return {
    activeCount,
    inactiveCount,
    statusBreakdown,
    totalBalance: totalBalance.toString(),
    performanceH: perfHCount > 0 ? perfHWeighted / perfHCount : null,
    performanceD: perfDCount > 0 ? perfDWeighted / perfDCount : null,
    performanceW: perfWCount > 0 ? perfWWeighted / perfWCount : null,
    performanceM: perfMCount > 0 ? perfMWeighted / perfMCount : null,
    apyD: apyDCount > 0 ? apyDWeighted / apyDCount : null,
    apyW: apyWCount > 0 ? apyWWeighted / apyWCount : null,
    apyM: apyMCount > 0 ? apyMWeighted / apyMCount : null,
    consensusRewardD: clRewardD ? clRewardD.toString() : null,
    consensusRewardW: clRewardW ? clRewardW.toString() : null,
    consensusRewardM: clRewardM ? clRewardM.toString() : null,
    executionRewardD: elRewardD ? { wei: '0', token: elRewardD.toString() } : null,
    executionRewardW: elRewardW ? { wei: '0', token: elRewardW.toString() } : null,
    executionRewardM: elRewardM ? { wei: '0', token: elRewardM.toString() } : null,
    claimableRewards: hasClaimableRewards ? claimableRewards.toString() : null,
    tokenPrice,
  };
}
