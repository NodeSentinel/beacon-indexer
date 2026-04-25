/**
 * Converts gWei to the chain token using the provided config.
 */
export function formatGweiToToken(gwei: bigint | string, chain: 'ethereum' | 'gnosis'): string {
  const GWEI_PER_TOKEN = BigInt(10) ** BigInt(9);
  const tokenMultiplier = chain === 'gnosis' ? BigInt(32) : BigInt(1);
  const gweiBigInt = typeof gwei === 'string' ? BigInt(gwei) : gwei;
  const wei = gweiBigInt * GWEI_PER_TOKEN;
  const weiAfterMultiplier = wei / tokenMultiplier;
  const weiString = weiAfterMultiplier.toString();
  const weiLength = weiString.length;

  if (weiLength <= 18) {
    const padded = weiString.padStart(18, '0');
    const decimalPart = padded.replace(/0+$/, '');
    return decimalPart ? `0.${decimalPart}` : '0';
  }

  const integerPart = weiString.slice(0, -18);
  const decimalPart = weiString.slice(-18).replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

/**
 * Sums several gWei reward parts into one bigint total.
 */
export function sumRewardsGwei(parts: Record<string, bigint | string | null | undefined>): bigint {
  let total = BigInt(0);

  for (const value of Object.values(parts)) {
    if (value === null || value === undefined) {
      continue;
    }

    const gweiBigInt = typeof value === 'string' ? BigInt(value) : value;
    total += gweiBigInt;
  }

  return total;
}

/**
 * Formats several gWei reward parts into aggregate values.
 */
export function formatRewardsFromGweiParts(
  parts: Record<string, bigint | string | null | undefined>,
  chain: 'ethereum' | 'gnosis',
): {
  totalGwei: string;
  token: string;
} {
  const totalGwei = sumRewardsGwei(parts);

  return {
    totalGwei: totalGwei.toString(),
    token: formatGweiToToken(totalGwei, chain),
  };
}

/**
 * Formats a nullable gWei balance into token units.
 */
export function formatBalance(
  gwei: bigint | string | null | undefined,
  chain: 'ethereum' | 'gnosis',
): string {
  if (gwei === null || gwei === undefined) {
    return '0';
  }

  return formatGweiToToken(gwei, chain);
}

/**
 * Converts wei to the chain native token using the configured decimals.
 */
export function formatWeiToToken(wei: bigint | string, nativeTokenDecimals: number): string {
  const decimals = nativeTokenDecimals;
  const weiBigInt = typeof wei === 'string' ? BigInt(wei) : wei;
  const weiString = weiBigInt.toString();
  const weiLength = weiString.length;

  if (weiLength <= decimals) {
    const padded = weiString.padStart(decimals, '0');
    const decimalPart = padded.replace(/0+$/, '');
    return decimalPart ? `0.${decimalPart}` : '0';
  }

  const integerPart = weiString.slice(0, -decimals);
  const decimalPart = weiString.slice(-decimals).replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}
