/**
 * Format cluster snapshot data into a Telegram MarkdownV2 message.
 *
 * Shows:
 * - Validator status (active/inactive)
 * - Performance (1h, 24h, 7d, 30d)
 * - Balance + USD value
 * - Rewards table (daily/weekly/monthly): APY, consensus, execution, total USD
 * - Token price + last updated timestamp
 */

interface ClusterSnapshotData {
  activeCount: number;
  inactiveCount: number;
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
  tokenPrice: number;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatPerformance(value: number | null): string {
  if (value === null) return '\\-';
  // Performance comes as ratio 0.0000-1.0000, convert to percentage
  return escapeMarkdown(`${(value * 100).toFixed(2)}%`);
}

function formatNumber(value: number | string | null, decimals = 2): string {
  if (value === null) return '\\-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '\\-';
  return escapeMarkdown(num.toFixed(decimals));
}

export function formatStatsMessage(snapshot: ClusterSnapshotData): string {
  const validatorStatus = `🟢 ${snapshot.activeCount} \\| 🟡 ${snapshot.inactiveCount}`;

  const performance = [
    `*Performance:*`,
    `  1h: ${formatPerformance(snapshot.performanceH)}`,
    `  24h: ${formatPerformance(snapshot.performanceD)}`,
    `  7d: ${formatPerformance(snapshot.performanceW)}`,
    `  30d: ${formatPerformance(snapshot.performanceM)}`,
  ].join('\n');

  const balance = parseFloat(snapshot.totalBalance);
  const balanceUsd = balance * snapshot.tokenPrice;
  const balanceLine = `*Balance:* ${formatNumber(snapshot.totalBalance, 4)} \\(${escapeMarkdown(`$${balanceUsd.toFixed(2)}`)}\\)`;

  const rewardsHeader = `━━━━━━━━━━━━━━━━━`;
  const rewardsTable = [
    rewardsHeader,
    `      *APY*    *CL*     *EL*     *USD*`,
    formatRewardRow(
      'd',
      snapshot.apyD,
      snapshot.consensusRewardD,
      snapshot.executionRewardD,
      snapshot.tokenPrice,
    ),
    formatRewardRow(
      'w',
      snapshot.apyW,
      snapshot.consensusRewardW,
      snapshot.executionRewardW,
      snapshot.tokenPrice,
    ),
    formatRewardRow(
      'm',
      snapshot.apyM,
      snapshot.consensusRewardM,
      snapshot.executionRewardM,
      snapshot.tokenPrice,
    ),
  ].join('\n');

  const footer = [
    `*Price:* ${escapeMarkdown(`$${snapshot.tokenPrice.toFixed(2)}`)}`,
    `*Updated:* ${escapeMarkdown(new Date().toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }))} UTC`,
  ].join('\n');

  return [
    `\`${validatorStatus}\``,
    '',
    performance,
    '',
    balanceLine,
    '',
    rewardsTable,
    '',
    footer,
  ].join('\n');
}

function formatRewardRow(
  period: string,
  apy: number | null,
  consensusReward: string | null,
  executionReward: { wei: string; token: string } | null,
  tokenPrice: number,
): string {
  const apyStr = formatNumber(apy, 2);
  const clStr = formatNumber(consensusReward, 4);
  const elStr = formatNumber(executionReward?.token ?? null, 4);

  // Total USD = (CL reward + EL reward) * tokenPrice
  const clAmount = consensusReward ? parseFloat(consensusReward) : 0;
  const elAmount = executionReward ? parseFloat(executionReward.token) : 0;
  const totalUsd = (clAmount + elAmount) * tokenPrice;
  const usdStr = escapeMarkdown(`$${totalUsd.toFixed(2)}`);

  return `*${period}:*  ${apyStr}%  ${clStr}  ${elStr}  ${usdStr}`;
}
