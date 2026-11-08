import { createPublicClient, defineChain, http, isAddress, type Address, type Hex } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { CHAIN_ID, REGISTRY_ADDRESS, RPC_URL, chainName } from '@/lib/chain';
import type { ClaimStatus } from '@/lib/types';

/** Read-only slice of VeriTradeInvoiceRegistry (see the Claim struct in the .sol file). */
export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'statusOf',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'isActive',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'claimOf',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'schemaVersion', type: 'uint16' },
          { name: 'generation', type: 'uint32' },
          { name: 'reservedAt', type: 'uint64' },
          { name: 'financedAt', type: 'uint64' },
          { name: 'closedAt', type: 'uint64' },
          { name: 'entityId', type: 'bytes32' },
          { name: 'registrar', type: 'address' },
          { name: 'financier', type: 'address' },
          { name: 'financingRef', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

const CLAIM_BY_INDEX: ClaimStatus[] = ['UNREGISTERED', 'RESERVED', 'FINANCED', 'CLOSED'];

export const COMMITMENT_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const registryAddress: Address | null = isAddress(REGISTRY_ADDRESS)
  ? REGISTRY_ADDRESS
  : null;

export interface RegistryLookup {
  commitment: Hex;
  status: ClaimStatus;
  generation: number;
  /** Unix seconds; 0 when the step never happened. */
  reservedAt: number;
  financedAt: number;
  closedAt: number;
}

function chain() {
  if (CHAIN_ID === 43113) return avalancheFuji;
  return defineChain({
    id: CHAIN_ID,
    name: chainName(),
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
}

export async function lookupCommitment(commitment: Hex): Promise<RegistryLookup> {
  if (!registryAddress) throw new Error('REGISTRY_NOT_CONFIGURED');
  const client = createPublicClient({ chain: chain(), transport: http(RPC_URL) });
  const [statusIndex, claim] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'statusOf',
      args: [commitment],
    }),
    client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'claimOf',
      args: [commitment],
    }),
  ]);
  const status = CLAIM_BY_INDEX[statusIndex];
  if (!status) throw new Error('UNKNOWN_CLAIM_STATUS');
  return {
    commitment,
    status,
    generation: claim.generation,
    reservedAt: Number(claim.reservedAt),
    financedAt: Number(claim.financedAt),
    closedAt: Number(claim.closedAt),
  };
}
