import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, hardhat } from 'viem/chains';

import { AppException } from '../common/errors/app.exception.js';

const FUJI_CHAIN_ID = 43113;
const LOCAL_CHAIN_ID = 31337;

/**
 * Built as free functions so the client types can be derived with
 * `ReturnType` instead of being written out by hand — viem's client generics
 * are large and hand-written aliases drift from the library.
 */
function buildPublicClient(chain: Chain, url: string) {
  // `cacheTime: 0` because this client is used for state transitions and
  // indexing. viem caches short-lived RPC reads by default, and a cached block
  // height is how an indexer misses a new block — or, worse, misses a reorg
  // because the cached hash still looks canonical.
  return createPublicClient({ chain, transport: http(url), cacheTime: 0 });
}

function buildWalletClient(chain: Chain, account: Account, url: string) {
  return createWalletClient({ chain, account, transport: http(url) });
}

export type RpcPublicClient = ReturnType<typeof buildPublicClient>;
export type RpcWalletClient = ReturnType<typeof buildWalletClient>;

/**
 * The single point of contact with the Avalanche C-Chain.
 *
 * Three states, deliberately distinguished:
 *
 *   * **unconfigured** — no registry address. Reads and writes both fail with
 *     503. This is the state of a checkout that has never deployed, and the app
 *     must still boot in it.
 *   * **read-only** — a registry address but no key. Chain queries work;
 *     signing fails with 503. Useful for a web tier that should not hold a key.
 *   * **writable** — both present.
 *
 * The private key is read once at construction and never leaves this object.
 * It is not logged, not serialised and not exposed on a getter.
 */
@Injectable()
export class AvalancheRpcService {
  readonly chainId: number;
  readonly chain: Chain;
  readonly contractAddress: Hex | null;
  readonly configured: boolean;
  readonly writable: boolean;
  readonly signerAddress: Hex | null;

  private readonly rpcUrl: string;
  private readonly account: Account | null;
  private publicClientCache: RpcPublicClient | null = null;
  private walletClientCache: RpcWalletClient | null = null;

  constructor(config: ConfigService) {
    const chainId = config.get<number>('AVALANCHE_CHAIN_ID') ?? FUJI_CHAIN_ID;
    this.chainId = chainId;
    this.chain = chainId === LOCAL_CHAIN_ID ? hardhat : avalancheFuji;

    const configuredUrl = config.get<string>('AVALANCHE_RPC_URL');
    this.rpcUrl =
      configuredUrl !== undefined && configuredUrl.trim() !== ''
        ? configuredUrl.trim()
        : (this.chain.rpcUrls.default.http[0] ?? 'http://127.0.0.1:8545');

    const address = config.get<string>('VERITRADE_CONTRACT_ADDRESS');
    this.contractAddress =
      address !== undefined && /^0x[0-9a-fA-F]{40}$/.test(address) ? (address as Hex) : null;

    const privateKey = config.get<string>('AVALANCHE_DEPLOYER_PRIVATE_KEY');
    this.account =
      privateKey !== undefined && /^0x[0-9a-fA-F]{64}$/.test(privateKey)
        ? privateKeyToAccount(privateKey as Hex)
        : null;

    this.configured = this.contractAddress !== null;
    this.writable = this.configured && this.account !== null;
    this.signerAddress = this.account === null ? null : (this.account.address as Hex);
  }

  /** The deployed registry address, or a 503 explaining why there is none. */
  requireContractAddress(): Hex {
    if (this.contractAddress === null) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BLOCKCHAIN_NOT_CONFIGURED',
        'No VeriTrade registry address is configured. Set VERITRADE_CONTRACT_ADDRESS to a deployed registry.',
      );
    }
    return this.contractAddress;
  }

  publicClient(): RpcPublicClient {
    this.requireContractAddress();
    this.publicClientCache ??= buildPublicClient(this.chain, this.rpcUrl);
    return this.publicClientCache;
  }

  /**
   * The signer. There is no fallback to an unlocked node account: a missing key
   * is an error, not an invitation to use whatever the node happens to hold.
   */
  signer(): { client: RpcWalletClient; account: Account } {
    this.requireContractAddress();
    if (this.account === null) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BLOCKCHAIN_SIGNER_NOT_CONFIGURED',
        'No deployer key is configured, so the API cannot submit registry transactions.',
      );
    }
    this.walletClientCache ??= buildWalletClient(this.chain, this.account, this.rpcUrl);
    return { client: this.walletClientCache, account: this.account };
  }
}
