export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '43113');
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc';
export const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_VERITRADE_CONTRACT_ADDRESS ?? '';

export const CHAIN_NAME: Record<number, string> = {
  43113: 'Avalanche Fuji',
  31337: 'Hardhat (local)',
};

export function chainName(chainId: number = CHAIN_ID): string {
  return CHAIN_NAME[chainId] ?? `Chain ${chainId}`;
}

/** Snowtrace only indexes public networks; a local chain has no explorer. */
export function explorerTx(txHash: string, chainId: number = CHAIN_ID): string | null {
  if (chainId !== 43113) return null;
  return `https://testnet.snowtrace.io/tx/${txHash}`;
}

export function explorerAddress(address: string, chainId: number = CHAIN_ID): string | null {
  if (chainId !== 43113 || !address) return null;
  return `https://testnet.snowtrace.io/address/${address}`;
}
