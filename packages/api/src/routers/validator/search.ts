/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chain } from '@beacon-indexer/beacon-utils';
import {
  type ValidatorSearchInput,
  ValidatorSearchInputSchema,
  ValidatorSearchResponseSchema,
  type ValidatorSearchResult,
} from './schemas.js';

import type { ApiProcedures } from '@/auth/middleware.js';
import { getOperatorActivePubkeys } from '@/services/lido/get-operator-active-pubkeys.js';
import { ApiResponseSchema } from '@/utils/response.js';

type ValidatorSearchStorage = {
  findByIndex: (index: number) => Promise<ValidatorSearchResult | null>;
  findByIndexes: (indexes: number[]) => Promise<ValidatorSearchResult[]>;
  findByPubkey: (pubkey: string) => Promise<ValidatorSearchResult | null>;
  findByPubkeys: (pubkeys: string[]) => Promise<ValidatorSearchResult[]>;
  findByWithdrawalAddress: (withdrawalAddress: string) => Promise<ValidatorSearchResult[]>;
  findByWithdrawalAddresses: (withdrawalAddresses: string[]) => Promise<ValidatorSearchResult[]>;
};

type SearchValidatorsParams = {
  chain: Chain;
  executionRpcUrl: string;
  input: ValidatorSearchInput;
  resolveLidoPubkeys?: typeof getOperatorActivePubkeys;
  validatorStorage: ValidatorSearchStorage;
};

export class UnsupportedLidoCsmChainError extends Error {
  /** Creates an unsupported-chain error for Lido CSM searches. */
  constructor() {
    super('Lido CSM validator search is only supported on Ethereum');
  }
}

/** Resolves validator search input into validator result rows. */
export async function searchValidators(
  params: SearchValidatorsParams,
): Promise<ValidatorSearchResult[]> {
  const validators: ValidatorSearchResult[] = [];

  if (params.input.index !== undefined) {
    const result = await params.validatorStorage.findByIndex(params.input.index);
    if (result) {
      validators.push(result);
    }
  } else if (params.input.indexes && params.input.indexes.length > 0) {
    validators.push(...(await params.validatorStorage.findByIndexes(params.input.indexes)));
  } else if (params.input.pubkey) {
    const result = await params.validatorStorage.findByPubkey(params.input.pubkey);
    if (result) {
      validators.push(result);
    }
  } else if (params.input.pubkeys && params.input.pubkeys.length > 0) {
    validators.push(...(await params.validatorStorage.findByPubkeys(params.input.pubkeys)));
  } else if (params.input.withdrawalAddress) {
    validators.push(
      ...(await params.validatorStorage.findByWithdrawalAddress(params.input.withdrawalAddress)),
    );
  } else if (params.input.withdrawalAddresses && params.input.withdrawalAddresses.length > 0) {
    validators.push(
      ...(await params.validatorStorage.findByWithdrawalAddresses(
        params.input.withdrawalAddresses,
      )),
    );
  } else if (params.input.lidoCsmOperatorId !== undefined) {
    if (params.chain !== 'ethereum') {
      throw new UnsupportedLidoCsmChainError();
    }

    const resolveLidoPubkeys = params.resolveLidoPubkeys ?? getOperatorActivePubkeys;
    const pubkeys = await resolveLidoPubkeys({
      operatorId: params.input.lidoCsmOperatorId,
      rpcUrl: params.executionRpcUrl,
    });

    validators.push(...(await params.validatorStorage.findByPubkeys(pubkeys)));
  }

  return validators;
}

/**
 * Creates the validator search route.
 */
export function createSearchValidatorsRoute(params: {
  executionRpcUrl: string;
  procedures: ApiProcedures;
  validatorStorage: ValidatorSearchStorage;
}) {
  const { securedProcedure } = params.procedures;

  return securedProcedure
    .route({ method: 'GET', path: '/validators/search' })
    .input(ValidatorSearchInputSchema)
    .output(ApiResponseSchema(ValidatorSearchResponseSchema))
    .handler(async ({ input }: any) => {
      try {
        const { env } = await import('@/config/env.js');
        const validators = await searchValidators({
          chain: env.CHAIN,
          executionRpcUrl: params.executionRpcUrl,
          input,
          validatorStorage: params.validatorStorage,
        });

        if (validators.length === 0 && Object.keys(input).length === 0) {
          return {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message:
                'Exactly one of index/es, pubkey/s, withdrawalAddress/es or lidoCsmOperatorId must be provided',
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        return {
          success: true,
          data: { validators },
          meta: { timestamp: new Date().toISOString() },
        };
      } catch (error) {
        if (error instanceof UnsupportedLidoCsmChainError) {
          return {
            success: false,
            error: {
              code: 'UNSUPPORTED_CHAIN',
              message: error.message,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }

        return {
          success: false,
          error: {
            code: 'VALIDATOR_SEARCH_ERROR',
            message: error instanceof Error ? error.message : 'Failed to search validators',
          },
          meta: { timestamp: new Date().toISOString() },
        };
      }
    });
}
