/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORPCError } from '@orpc/server';
import { addDays, isAfter } from 'date-fns';
import { z } from 'zod';

import { ClaimUserResponseSchema } from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { CLAIM_COOLDOWN_DAYS } from '@/constants/claim.js';
import type { Logger } from '@/lib/logger.js';
import type { ClaimWithdrawalsService } from '@/services/gnosis/claim-withdrawals.js';
import type { ApiResponse } from '@/utils/response.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

type Chain = 'ethereum' | 'gnosis';

interface ClaimUser {
  id: string;
  telegramId: bigint | null;
  lastClaimed: Date | null;
}

interface UserClaimStorage {
  findClaimUserById: (userId: string) => Promise<ClaimUser | null>;
  listOwnedClusterWithdrawalAddresses: (userId: string) => Promise<string[]>;
  clearClaimableWithdrawalAddresses: (withdrawalAddresses: string[]) => Promise<unknown>;
  finalizeSuccessfulClaim: (params: {
    claimedAt: Date;
    userId: string;
    withdrawalAddresses: string[];
  }) => Promise<unknown>;
  updateLastClaimed: (userId: string, claimedAt: Date) => Promise<unknown>;
}

interface ExecuteUserClaimParams {
  chain: Chain;
  claimWithdrawalsService: ClaimWithdrawalsService | null;
  logger?: Pick<Logger, 'error'>;
  now: Date;
  userId: string;
  userStorage: UserClaimStorage;
}

const ClaimUserApiResponseSchema = ApiResponseSchema(ClaimUserResponseSchema);
type ClaimUserResponse = z.infer<typeof ClaimUserResponseSchema>;
type ClaimUserApiResponse = z.infer<typeof ClaimUserApiResponseSchema>;

/** Removes repeated addresses while preserving the first occurrence order. */
function uniqueAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();

  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/** Calculates the next time the user may claim based on the last successful claim. */
function getNextClaimAt(claimedAt: Date): Date {
  return addDays(claimedAt, CLAIM_COOLDOWN_DAYS);
}

/** Produces a typed claim error so transport handlers keep one response shape. */
function claimError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<ClaimUserResponse> {
  return errorResponse(code, message, details) as ApiResponse<ClaimUserResponse>;
}

/** Runs the claim business rules independently from the oRPC transport wrapper. */
export async function executeUserClaim(
  params: ExecuteUserClaimParams,
): Promise<ApiResponse<ClaimUserResponse>> {
  if (params.chain === 'ethereum') {
    throw new ORPCError('NOT_IMPLEMENTED', {
      message: 'Claiming is not implemented for Ethereum',
    });
  }

  if (!params.claimWithdrawalsService) {
    return claimError('CLAIM_UNAVAILABLE', 'Claiming is not available for this deployment');
  }

  const user = await params.userStorage.findClaimUserById(params.userId);
  if (!user?.telegramId) {
    return claimError('CLAIM_TELEGRAM_REQUIRED', 'Telegram authentication is required to claim');
  }

  if (user.lastClaimed) {
    const nextClaimAt = getNextClaimAt(user.lastClaimed);
    if (isAfter(nextClaimAt, params.now)) {
      return claimError('CLAIM_COOLDOWN_ACTIVE', 'Claim cooldown is still active', {
        nextClaimAt: nextClaimAt.toISOString(),
      });
    }
  }

  const claimedAddresses = uniqueAddresses(
    await params.userStorage.listOwnedClusterWithdrawalAddresses(params.userId),
  );
  if (claimedAddresses.length === 0) {
    return claimError('CLAIM_ADDRESSES_EMPTY', 'No cluster withdrawal addresses to claim');
  }

  let transaction: Awaited<ReturnType<ClaimWithdrawalsService['claimWithdrawals']>>;

  try {
    transaction = await params.claimWithdrawalsService.claimWithdrawals(claimedAddresses);
  } catch (error) {
    return claimError(
      'CLAIM_TX_ERROR',
      error instanceof Error ? error.message : 'Failed to send claim transaction',
    );
  }

  try {
    await params.userStorage.finalizeSuccessfulClaim({
      claimedAt: params.now,
      userId: params.userId,
      withdrawalAddresses: claimedAddresses,
    });
  } catch (error) {
    params.logger?.error(
      {
        err: error,
        transactionHash: transaction.transactionHash,
        userId: params.userId,
      },
      'Failed to finalize successful claim',
    );
  }

  return successResponse({
    claimedAddresses,
    nextClaimAt: getNextClaimAt(params.now).toISOString(),
    transactionHash: transaction.transactionHash,
    transactionUrl: transaction.transactionUrl,
  });
}

/** Creates the current-user claim route. */
export function createUserClaimRoute(params: {
  chain: Chain;
  claimWithdrawalsService: ClaimWithdrawalsService | null;
  logger?: Pick<Logger, 'error'>;
  procedures: ApiProcedures;
  userStorage: UserClaimStorage;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'POST', path: '/users/me/claim' })
    .output(ClaimUserApiResponseSchema)
    .handler(async ({ context }: any) => {
      if (!context.user) {
        return errorResponse(
          'UNAUTHORIZED',
          'User authentication required',
        ) as ClaimUserApiResponse;
      }

      return executeUserClaim({
        chain: params.chain,
        claimWithdrawalsService: params.claimWithdrawalsService,
        logger: params.logger,
        now: new Date(),
        userId: context.user.id,
        userStorage: params.userStorage,
      }) as Promise<ClaimUserApiResponse>;
    });
}
