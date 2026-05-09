import { createPublicClient, getContract, http } from 'viem';
import { mainnet } from 'viem/chains';

import { LIDO_CSM_ABI, LIDO_CSM_MODULE_ADDRESS } from '@/constants/lido-csm.js';

type LidoCsmContractReader = {
  read: {
    getNodeOperator: (args: readonly [bigint]) => Promise<readonly unknown[] | LidoCsmNodeOperator>;
    getSigningKeys: (args: readonly [bigint, bigint, bigint]) => Promise<string>;
  };
};

const PUBKEY_HEX_LENGTH = 96;

type LidoCsmNodeOperator = {
  totalDepositedKeys: bigint | number | string;
  totalExitedKeys: bigint | number | string;
};

/** Checks whether viem decoded the tuple as an array. */
function isNodeOperatorTupleArray(
  nodeOperator: readonly unknown[] | LidoCsmNodeOperator,
): nodeOperator is readonly unknown[] {
  return Array.isArray(nodeOperator);
}

/** Reads a tuple value from viem array-style or object-style ABI decoding. */
function readNodeOperatorCounter(
  nodeOperator: readonly unknown[] | LidoCsmNodeOperator,
  index: number,
  key: keyof LidoCsmNodeOperator,
) {
  if (isNodeOperatorTupleArray(nodeOperator)) {
    return nodeOperator[index] as bigint | number | string;
  }

  return nodeOperator[key];
}

/** Creates a Lido CSM contract reader for Ethereum mainnet. */
export function createLidoCsmContract(rpcUrl: string): LidoCsmContractReader {
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  return getContract({
    address: LIDO_CSM_MODULE_ADDRESS,
    abi: LIDO_CSM_ABI,
    client: publicClient,
  }) as unknown as LidoCsmContractReader;
}

/** Loads active validator pubkeys for a Lido CSM operator through the configured RPC. */
export async function getOperatorActivePubkeys(params: {
  operatorId: number;
  rpcUrl: string;
}): Promise<string[]> {
  return getOperatorActivePubkeysFromContract(
    createLidoCsmContract(params.rpcUrl),
    params.operatorId,
  );
}

/** Extracts active validator pubkeys from a Lido CSM contract reader. */
export async function getOperatorActivePubkeysFromContract(
  contract: LidoCsmContractReader,
  operatorId: number,
): Promise<string[]> {
  const nodeOperatorTuple = await contract.read.getNodeOperator([BigInt(operatorId)]);
  const totalDepositedKeys = BigInt(
    readNodeOperatorCounter(nodeOperatorTuple, 2, 'totalDepositedKeys'),
  );
  const totalExitedKeys = BigInt(readNodeOperatorCounter(nodeOperatorTuple, 8, 'totalExitedKeys'));
  const activeCount = totalDepositedKeys - totalExitedKeys;

  if (activeCount <= 0n) {
    return [];
  }

  const keysBytes = await contract.read.getSigningKeys([
    BigInt(operatorId),
    totalExitedKeys,
    activeCount,
  ]);
  const hex = keysBytes.startsWith('0x') ? keysBytes.slice(2) : keysBytes;
  const totalKeys = Math.floor(hex.length / PUBKEY_HEX_LENGTH);
  const pubkeys: string[] = [];

  for (let i = totalKeys - 1; i >= 0; i--) {
    const start = i * PUBKEY_HEX_LENGTH;
    const chunk = hex.slice(start, start + PUBKEY_HEX_LENGTH);

    if (chunk.length === PUBKEY_HEX_LENGTH) {
      pubkeys.push(`0x${chunk}`);
    }
  }

  return pubkeys;
}
