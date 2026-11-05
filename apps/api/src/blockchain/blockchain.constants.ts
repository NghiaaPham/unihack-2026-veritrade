import { keccak256, parseAbi, toBytes, toFunctionSelector, type Hex } from 'viem';

/**
 * The slice of the registry ABI the backend uses.
 *
 * Declared as a human-readable ABI rather than copied from the artifact: it is
 * reviewed by reading, and a mismatch with the contract shows up immediately as
 * a decode failure in tests. `test/blockchain-abi.spec.ts` asserts that every
 * entry here exists in the compiled artifact, so drift is caught mechanically
 * rather than at the first production call.
 */
export const REGISTRY_ABI = parseAbi([
  'function register(bytes32 commitment, bytes32 entityId) returns (uint32)',
  'function declareFinanced(bytes32 commitment, bytes32 financingRef)',
  'function cancelReservation(bytes32 commitment)',
  'function closeClaim(bytes32 commitment)',
  'function statusOf(bytes32 commitment) view returns (uint8)',
  'function isActive(bytes32 commitment) view returns (bool)',
  'function commitmentFor(bytes32 identityDigest) pure returns (bytes32)',
  'event InvoiceReserved(bytes32 indexed commitment, bytes32 indexed entityId, address indexed registrar, uint32 generation, uint16 schemaVersion, uint64 blockTimestamp)',
  'event FinancingDeclared(bytes32 indexed commitment, address indexed financier, bytes32 financingRef, uint32 generation, uint64 blockTimestamp)',
  'event ReservationCancelled(bytes32 indexed commitment, bytes32 indexed entityId, address indexed registrar, address cancelledBy, uint32 generation, uint64 blockTimestamp)',
  'event ClaimClosed(bytes32 indexed commitment, address indexed closedBy, address indexed financier, uint32 generation, uint64 blockTimestamp)',
  'error ZeroAddress()',
  'error ZeroCommitment()',
  'error ZeroEntityId()',
  'error ZeroFinancingRef()',
  'error ClaimAlreadyActive(bytes32 commitment, uint8 current)',
  'error ClaimIsTerminal(bytes32 commitment)',
  'error NotReserved(bytes32 commitment, uint8 current)',
  'error NotFinanced(bytes32 commitment, uint8 current)',
  'error NotDeclaringFinancier(bytes32 commitment, address caller)',
  'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
  'error EnforcedPause()',
]);

/**
 * Custom-error selectors, by 4-byte signature.
 *
 * Needed because a node may return only the selector and no arguments, which
 * leaves viem unable to name the error. Mapping the selector ourselves keeps
 * `SIMULATION_REVERTED:ClaimAlreadyActive` readable instead of `Reverted`.
 */
export const REGISTRY_ERROR_NAMES: ReadonlyMap<string, string> = new Map(
  REGISTRY_ABI.filter((entry) => entry.type === 'error').map((entry) => [
    toFunctionSelector(`${entry.name}(${entry.inputs.map((input) => input.type).join(',')})`),
    entry.name,
  ]),
);

/**
 * Domain separator mixed into every commitment.
 *
 * Must equal `COMMITMENT_DOMAIN` in VeriTradeInvoiceRegistry.sol. It keeps the
 * on-chain commitment distinct from the Phase 3 database fingerprint, so a
 * leaked fingerprint is not itself a chain lookup key.
 */
export const COMMITMENT_DOMAIN: Hex = keccak256(toBytes('vt-invoice-commitment-v1'));

/** Must equal `SCHEMA_VERSION` in the contract. */
export const COMMITMENT_SCHEMA_VERSION = 1;

/** Domain for the opaque organization handle passed to `register`. */
export const ENTITY_DOMAIN_LABEL = 'vt-entity-v1';

/** Domain for the opaque financing-request handle passed to `declareFinanced`. */
export const FINANCING_REF_DOMAIN_LABEL = 'vt-financing-ref-v1';

/**
 * Contract `ClaimStatus`, indexed by the uint8 the contract returns.
 *
 * The order is the enum's declaration order; a mismatch would silently relabel
 * states, so `test/blockchain-commitment.spec.ts` pins the mapping.
 */
export const CLAIM_STATUSES = ['UNREGISTERED', 'RESERVED', 'FINANCED', 'CLOSED'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function claimStatusOf(value: number): ClaimStatus {
  return CLAIM_STATUSES[value] ?? 'UNREGISTERED';
}

/** How long a request waits for a receipt before answering 202. */
export const RECEIPT_WAIT_TIMEOUT_MS = 20_000;

/** Receipt polling interval. Avalanche C-Chain blocks are ~2s. */
export const RECEIPT_POLL_INTERVAL_MS = 1_000;

/**
 * Maximum block span per `eth_getLogs` call. Public RPC endpoints reject wide
 * ranges, and an unbounded scan on first run would ask for the whole chain.
 */
export const MAX_BLOCK_RANGE = 2_000;
