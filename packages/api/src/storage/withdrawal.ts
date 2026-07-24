import { PrismaClient } from '@beacon-indexer/db';

export interface WithdrawalEventRow {
  source: 'payload' | 'request';
  slot: number;
  event_index: string;
  validator_index: number;
  pubkey: string | null;
  source_address: string | null;
  amount: bigint;
}

interface SortableWithdrawalEventRow extends WithdrawalEventRow {
  sort_index: bigint;
}

/**
 * Sorts mixed withdrawal sources the same way the previous SQL union did.
 */
function compareWithdrawalEvents(
  left: SortableWithdrawalEventRow,
  right: SortableWithdrawalEventRow,
) {
  if (left.slot !== right.slot) {
    return right.slot - left.slot;
  }

  const sourceRank = { payload: 0, request: 1 };
  const sourceOrder = sourceRank[left.source] - sourceRank[right.source];
  if (sourceOrder !== 0) {
    return sourceOrder;
  }

  if (left.sort_index === right.sort_index) {
    return 0;
  }

  return left.sort_index > right.sort_index ? -1 : 1;
}

export class WithdrawalStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists execution payload and request withdrawals for validators in the selected cluster.
   */
  async getWithdrawals(params: { clusterId: string; page: number; pageSize: number }) {
    const { clusterId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const pageWindowSize = offset + pageSize;

    const clusterValidators = await this.prisma.clusterValidator.findMany({
      where: { clusterId },
      select: {
        validatorIndex: true,
        validator: { select: { pubkey: true } },
      },
    });
    const validatorIndexes = clusterValidators.map(
      (clusterValidator) => clusterValidator.validatorIndex,
    );
    const validatorIndexStrings = validatorIndexes.map(String);
    const validatorIndexByPubkey = new Map(
      clusterValidators
        .filter(
          (
            clusterValidator,
          ): clusterValidator is { validatorIndex: number; validator: { pubkey: string } } =>
            clusterValidator.validator.pubkey !== null,
        )
        .map((clusterValidator) => [
          clusterValidator.validator.pubkey,
          clusterValidator.validatorIndex,
        ]),
    );
    const pubkeys = Array.from(validatorIndexByPubkey.keys());

    if (validatorIndexes.length === 0) {
      return { rows: [], totalCount: 0 };
    }

    const [payloadWithdrawals, requestWithdrawals, payloadCount, requestCount] = await Promise.all([
      this.prisma.validatorWithdrawals.findMany({
        where: { validatorIndex: { in: validatorIndexStrings } },
        orderBy: [{ slot: 'desc' }, { withdrawalIndex: 'desc' }],
        take: pageWindowSize,
      }),
      this.prisma.validatorWithdrawalsRequests.findMany({
        where: { pubKey: { in: pubkeys } },
        orderBy: [{ slot: 'desc' }, { requestIndex: 'desc' }],
        take: pageWindowSize,
      }),
      this.prisma.validatorWithdrawals.count({
        where: { validatorIndex: { in: validatorIndexStrings } },
      }),
      this.prisma.validatorWithdrawalsRequests.count({
        where: { pubKey: { in: pubkeys } },
      }),
    ]);
    const events: SortableWithdrawalEventRow[] = [
      ...payloadWithdrawals.map((withdrawal) => ({
        source: 'payload' as const,
        slot: withdrawal.slot,
        event_index: withdrawal.withdrawalIndex.toString(),
        sort_index: withdrawal.withdrawalIndex,
        validator_index: Number(withdrawal.validatorIndex),
        pubkey: null,
        source_address: null,
        amount: withdrawal.amount,
      })),
      ...requestWithdrawals.map((withdrawal) => ({
        source: 'request' as const,
        slot: withdrawal.slot,
        event_index: withdrawal.requestIndex.toString(),
        sort_index: BigInt(withdrawal.requestIndex),
        validator_index: validatorIndexByPubkey.get(withdrawal.pubKey)!,
        pubkey: withdrawal.pubKey,
        source_address: withdrawal.sourceAddress,
        amount: withdrawal.amount,
      })),
    ];
    const rows = events
      .sort(compareWithdrawalEvents)
      .slice(offset, offset + pageSize)
      .map(({ sort_index: _sortIndex, ...event }) => event);

    return { rows, totalCount: payloadCount + requestCount };
  }
}
