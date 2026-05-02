export type RpcBlock = {
  number: string; // hex
  timestamp: string; // hex
  miner: string; // fee recipient address
  baseFeePerGas: string; // hex
};

export type RpcTransactionReceipt = {
  gasUsed: string; // hex
  effectiveGasPrice: string; // hex
};

export type JsonRpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result: T;
  error?: { code: number; message: string };
};
