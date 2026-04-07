import {
  getChainConfig,
  type Chain,
  type ChainConfig,
} from '@beacon-indexer/beacon-utils/config/chain';

const DEFAULT_CHAIN: Chain = 'gnosis';
const DEFAULT_ARCHIVE_DETAIL_RETENTION_DAYS = 14;

function isSupportedChain(value: string | undefined): value is Chain {
  return value === 'gnosis' || value === 'ethereum';
}

export function getRuntimeChainConfig(): ChainConfig {
  return getChainConfig(isSupportedChain(process.env.CHAIN) ? process.env.CHAIN : DEFAULT_CHAIN);
}

export function getArchiveDetailRetentionDays(): number {
  const parsed = Number(process.env.ARCHIVE_DETAIL_RETENTION_DAYS);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_ARCHIVE_DETAIL_RETENTION_DAYS;
}
