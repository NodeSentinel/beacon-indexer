export const LIDO_CSM_MODULE_ADDRESS = '0xdA7dE2ECdDfccC6c3AF10108Db212ACBBf9EA83F' as const;

export const LIDO_CSM_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'nodeOperatorId', type: 'uint256' }],
    name: 'getNodeOperator',
    outputs: [
      {
        components: [
          { internalType: 'uint32', name: 'totalAddedKeys', type: 'uint32' },
          { internalType: 'uint32', name: 'totalWithdrawnKeys', type: 'uint32' },
          { internalType: 'uint32', name: 'totalDepositedKeys', type: 'uint32' },
          { internalType: 'uint32', name: 'totalVettedKeys', type: 'uint32' },
          { internalType: 'uint32', name: 'stuckValidatorsCount', type: 'uint32' },
          { internalType: 'uint32', name: 'depositableValidatorsCount', type: 'uint32' },
          { internalType: 'uint32', name: 'targetLimit', type: 'uint32' },
          { internalType: 'uint8', name: 'targetLimitMode', type: 'uint8' },
          { internalType: 'uint32', name: 'totalExitedKeys', type: 'uint32' },
          { internalType: 'uint32', name: 'enqueuedCount', type: 'uint32' },
          { internalType: 'address', name: 'managerAddress', type: 'address' },
          { internalType: 'address', name: 'proposedManagerAddress', type: 'address' },
          { internalType: 'address', name: 'rewardAddress', type: 'address' },
          { internalType: 'address', name: 'proposedRewardAddress', type: 'address' },
          { internalType: 'bool', name: 'extendedManagerPermissions', type: 'bool' },
          { internalType: 'bool', name: 'usedPriorityQueue', type: 'bool' },
        ],
        internalType: 'struct NodeOperator',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'nodeOperatorId', type: 'uint256' },
      { internalType: 'uint256', name: 'startIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'keysCount', type: 'uint256' },
    ],
    name: 'getSigningKeys',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
