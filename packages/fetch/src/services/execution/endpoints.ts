import { Decimal } from '@prisma/client/runtime/library';
import { AxiosResponse } from 'axios';
import ms from 'ms';

import { env, chainConfig } from '@/src/lib/env.js';
import { Blockscout_Blocks, Etherscan_BlockReward } from '@/src/services/execution/types.js';
import { instance } from '@/src/services/execution/utils/instance.js';

export type BlockResponse = {
  address: string;
  timestamp: Date;
  amount: Decimal;
  blockNumber: number;
};

export async function getBlock(blockNumber: number): Promise<BlockResponse | null> {
  let lastError: unknown;

  // First endpoint is blockscout, second is etherscan
  const endpoints = [
    // Blockscout
    //https://eth.blockscout.com/api/v2/blocks
    {
      url: `${env.EXECUTION_API_URL}/api/v2/blocks/${blockNumber}`,
      process: (response: AxiosResponse<Blockscout_Blocks>) => {
        const blockInfo = response.data;
        const minerReward = blockInfo.rewards.find((r) => r.type === 'Miner Reward');

        if (
          !blockInfo.miner ||
          !blockInfo.miner.hash ||
          !minerReward ||
          new Decimal(minerReward.reward).eq(0)
        ) {
          throw new Error(`Unexpected block response: ${JSON.stringify(blockInfo)}`);
        }

        const result: BlockResponse = {
          address: blockInfo.miner.hash,
          timestamp: new Date(blockInfo.timestamp),
          amount: minerReward ? new Decimal(minerReward.reward) : new Decimal(0),
          blockNumber: blockInfo.height,
        };
        return result;
      },
    },
    // Etherscan
    // https://api.etherscan.io/api?module=block&action=getblockreward&blockno=2165403&apikey=YourApiKeyToken
    {
      url: `${env.EXECUTION_API_BKP_URL}/api?chainid=${chainConfig.blockchain.chainId}&module=block&action=getblockreward&blockno=${blockNumber}&apikey=${env.EXECUTION_API_BKP_KEY}`,
      process: (response: AxiosResponse<Etherscan_BlockReward>) => {
        const blockInfo = response.data;
        const result: BlockResponse = {
          address: blockInfo.result.blockMiner,
          timestamp: new Date(Number(blockInfo.result.timeStamp) * 1000),
          amount: new Decimal(blockInfo.result.blockReward),
          blockNumber: Number(blockInfo.result.blockNumber),
        };
        return result;
      },
    },
  ];

  // Try each endpoint
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    try {
      const response = await instance.get(endpoint.url);
      return endpoint.process(response);
    } catch (error) {
      lastError = error;

      // Wait one slot before trying the next endpoint
      if (i < endpoints.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, ms(`${chainConfig.beacon.slotDurationInSeconds}s`)),
        );
      }
    }
  }

  // If all endpoints fail, throw the last error
  throw lastError;
}
