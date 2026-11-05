import { encodeFunctionData, type Hex } from 'viem';

import type { BlockchainOperation } from '../generated/prisma/client.js';
import { REGISTRY_ABI } from './blockchain.constants.js';

/** The fields of an operation that determine the call it represents. */
export type RegistryCallInput = Pick<
  BlockchainOperation,
  'kind' | 'commitment' | 'entityId' | 'financingRef'
>;

/**
 * ABI-encoded calldata for an operation.
 *
 * Used as the `payloadHash` of the confirmed `BlockchainRecord`: it is a stable
 * fingerprint of exactly what was sent, so a record can be checked against the
 * transaction rather than trusted.
 *
 * The switch is written out per function name instead of passing a computed
 * name to viem. viem derives argument types from the name, so a dynamic name
 * collapses the types to `unknown` and loses the compile-time check that the
 * argument list matches the function.
 */
export function callDataFor(operation: RegistryCallInput): Hex {
  switch (operation.kind) {
    case 'INVOICE_ANCHOR':
      return encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [asHex(operation.commitment), asHex(operation.entityId)],
      });
    case 'RESERVATION_CANCEL':
      return encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: 'cancelReservation',
        args: [asHex(operation.commitment)],
      });
    case 'FINANCING_DECLARE':
      return encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: 'declareFinanced',
        args: [asHex(operation.commitment), asHex(operation.financingRef)],
      });
    case 'FINANCING_CLOSE':
      return encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: 'closeClaim',
        args: [asHex(operation.commitment)],
      });
  }
}

/**
 * Narrowing helper for a nullable column.
 *
 * A null here means the row was written by a path that skipped validation, so
 * failing loudly beats sending a zero-filled call.
 */
function asHex(value: string | null): Hex {
  if (value === null) {
    throw new Error('Registry call is missing a required argument');
  }
  return value as Hex;
}

/**
 * JSON-safe view of the call, for the audit metadata of a confirmed operation.
 *
 * A concrete object type rather than `Prisma.InputJsonValue`: the latter is a
 * union, and spreading a union into an object literal is not allowed.
 */
export function callSummary(operation: RegistryCallInput): Record<string, string> {
  const summary: Record<string, string> = {
    kind: operation.kind,
    commitment: operation.commitment,
  };

  if (operation.entityId !== null) summary.entityId = operation.entityId;
  if (operation.financingRef !== null) summary.financingRef = operation.financingRef;

  return summary;
}
