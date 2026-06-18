/**
 * Format cluster snapshot data into a Telegram MarkdownV2 message.
 *
 * Uses the same escape strategy and format as the v1 bot:
 * build the message with normal markdown, then escapeMarkdown at the end
 * (escapes everything, then unescapes formatting marks).
 */
import { env } from '@/src/env.js';

interface ClusterSnapshotData {
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

// Chain-specific display configuration derived from CHAIN env
const chainDisplay =
  env.CHAIN === 'gnosis'
    ? {
        tokenSymbol: 'GNO',
        clRewardsSymbol: 'GNO',
        elRewardsSymbol: 'xDAI',
        feeRewardsInStable: true,
      }
    : {
        tokenSymbol: 'ETH',
        clRewardsSymbol: 'CL',
        elRewardsSymbol: 'EL',
        feeRewardsInStable: false,
      };

// --- Escape strategy copied from v1 bot ---

function escapeMarkdown(text: string): string {
  let escaped = text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');

  escaped = escaped.replace(/\\`/g, '`');
  escaped = escaped.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  escaped = escaped.replace(/\\\(/g, '(').replace(/\\\)/g, ')');
  escaped = escaped.replace(/\\\*/g, '*');

  return escaped;
}

// --- Number formatting copied from v1 bot ---

function formatNumber(value: number, maxDigits = 5, symbol?: string): string {
  const prefix = symbol ?? '';
  const intPart = Math.floor(Math.abs(value));
  const intLen = intPart.toString().length;

  if (intLen >= maxDigits) {
    return `${prefix}${intPart.toLocaleString('en-US')}`;
  }

  const decimalDigits = maxDigits - intLen;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimalDigits,
    maximumFractionDigits: decimalDigits,
    minimumIntegerDigits: 1,
  });

  const totalLen = maxDigits + (formatted.includes('.') ? 1 : 0);
  return `${prefix}${formatted.padStart(totalLen, '0')}`;
}

// --- Table column formatting copied from v1 bot ---

function formatTableColumn(
  value: string | number,
  width: number,
  align: 'left' | 'center' | 'right' = 'center',
): string {
  const strValue = String(value);
  const padding = width - strValue.length;

  if (padding <= 0) return strValue;

  const leftPad = align === 'center' ? Math.floor(padding / 2) : align === 'right' ? padding : 0;
  const rightPad = padding - leftPad;

  return ' '.repeat(leftPad) + strValue + ' '.repeat(rightPad);
}

/**
 * Calculate USD value for a reward period.
 * CL rewards are in the staking token (GNO/ETH) → multiply by tokenPrice.
 * EL rewards on Gnosis are in xDAI (stable, ~$1) → use as-is.
 * EL rewards on Ethereum are in ETH → multiply by tokenPrice.
 */
function calculateRewardUsd(cl: number, el: number, tokenPrice: number): number {
  const clUsd = cl * tokenPrice;
  const elUsd = chainDisplay.feeRewardsInStable ? el : el * tokenPrice;
  return clUsd + elUsd;
}

export function formatStatsMessage(snapshot: ClusterSnapshotData): string {
  const { activeCount, inactiveCount, statusBreakdown, tokenPrice } = snapshot;
  const balance = parseFloat(snapshot.totalBalance);

  // Count slashed and exited from statusBreakdown
  // Keys are numeric strings matching VALIDATOR_STATUS codes:
  // 4 = active_slashed, 5 = exited_unslashed, 6 = exited_slashed
  const slashedCount = (statusBreakdown['4'] ?? 0) + (statusBreakdown['6'] ?? 0);
  const exitedCount = (statusBreakdown['5'] ?? 0) + (statusBreakdown['6'] ?? 0);

  // Validator status
  const validatorStatus = `🟢 ${activeCount}  🟡 ${inactiveCount}  🚫 ${slashedCount}  🔚 ${exitedCount}`;

  // Performance (1h only, like v1)
  const perfStr =
    snapshot.performanceH != null ? `${(snapshot.performanceH * 100).toFixed(2)}%` : '-';

  // Main stats
  const claimable = snapshot.claimableRewards ? parseFloat(snapshot.claimableRewards) : 0;
  const mainStats = [
    `*Last 1h performance:* ${perfStr}`,
    `*Bal:* ${formatNumber(balance)} ${chainDisplay.tokenSymbol} $${formatNumber(balance * tokenPrice)}`,
    ...(env.CHAIN === 'gnosis'
      ? [
          `*Claimable:* ${formatNumber(claimable)} ${chainDisplay.tokenSymbol} $${formatNumber(claimable * tokenPrice)}`,
        ]
      : []),
  ].join('\n');

  // Rewards table
  const dCl = snapshot.consensusRewardD ? parseFloat(snapshot.consensusRewardD) : 0;
  const dEl = snapshot.executionRewardD ? parseFloat(snapshot.executionRewardD.token) : 0;
  const wCl = snapshot.consensusRewardW ? parseFloat(snapshot.consensusRewardW) : 0;
  const wEl = snapshot.executionRewardW ? parseFloat(snapshot.executionRewardW.token) : 0;
  const mCl = snapshot.consensusRewardM ? parseFloat(snapshot.consensusRewardM) : 0;
  const mEl = snapshot.executionRewardM ? parseFloat(snapshot.executionRewardM.token) : 0;

  const dUsd = calculateRewardUsd(dCl, dEl, tokenPrice);
  const wUsd = calculateRewardUsd(wCl, wEl, tokenPrice);
  const mUsd = calculateRewardUsd(mCl, mEl, tokenPrice);

  const hdr = `${formatTableColumn('', 3)}${formatTableColumn('APY%', 7)}${formatTableColumn(chainDisplay.clRewardsSymbol, 8)}${formatTableColumn(chainDisplay.elRewardsSymbol, 8)}${formatTableColumn('Total', 9)}`;
  const rowD = `${formatTableColumn('d:', 3, 'left')}${formatTableColumn(formatNumber(snapshot.apyD ?? 0, 4), 7)}${formatTableColumn(formatNumber(dCl, 3), 8)}${formatTableColumn(formatNumber(dEl, 3), 8)}${formatTableColumn(formatNumber(dUsd, 4, '$'), 9)}`;
  const rowW = `${formatTableColumn('w:', 3, 'left')}${formatTableColumn(formatNumber(snapshot.apyW ?? 0, 4), 7)}${formatTableColumn(formatNumber(wCl, 3), 8)}${formatTableColumn(formatNumber(wEl, 3), 8)}${formatTableColumn(formatNumber(wUsd, 4, '$'), 9)}`;
  const rowM = `${formatTableColumn('m:', 3, 'left')}${formatTableColumn(formatNumber(snapshot.apyM ?? 0, 4), 7)}${formatTableColumn(formatNumber(mCl, 3), 8)}${formatTableColumn(formatNumber(mEl, 3), 8)}${formatTableColumn(formatNumber(mUsd, 4, '$'), 9)}`;

  const rewardsSection = [`\`${hdr}\``, `\`${rowD}\``, `\`${rowW}\``, `\`${rowM}\``].join('\n');

  // Footer
  const footer = [
    `*${chainDisplay.tokenSymbol}:* $${tokenPrice.toFixed(2)}`,
    `*Updated:* ${new Date().toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).toLowerCase()} UTC`,
  ].join('\n');

  const message = [`\`${validatorStatus}\``, '', mainStats, '', rewardsSection, '', footer].join(
    '\n',
  );

  return escapeMarkdown(message);
}
