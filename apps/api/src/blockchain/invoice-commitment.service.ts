import { HttpStatus, Injectable } from '@nestjs/common';
import { encodeAbiParameters, keccak256, toBytes, type Hex } from 'viem';

import { AppException } from '../common/errors/app.exception.js';
import {
  IncompleteIdentityError,
  canonicalIdentity,
  sha256Hex,
} from '../invoices/invoice-fingerprint.js';
import {
  COMMITMENT_DOMAIN,
  COMMITMENT_SCHEMA_VERSION,
  ENTITY_DOMAIN_LABEL,
  FINANCING_REF_DOMAIN_LABEL,
} from './blockchain.constants.js';

/**
 * The subset of an invoice row the commitment depends on.
 *
 * Declared structurally so this service can be tested without a Prisma row and
 * so it is obvious that nothing else about the invoice reaches the chain.
 */
export interface InvoiceIdentitySource {
  issuerTaxId: string;
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  fingerprint: string;
}

export interface InvoiceCommitment {
  /** The canonical string the digest is taken over. Never leaves the process. */
  canonicalIdentity: string;
  /** `sha256(canonicalIdentity)`, equal to the Phase 3 fingerprint. */
  identityDigest: Hex;
  /** `keccak256(abi.encode(domain, version, identityDigest))`. Goes on-chain. */
  commitment: Hex;
}

/**
 * Builds the values the registry contract expects.
 *
 * Three separate derivations live here because they are easy to confuse and
 * expensive to get wrong:
 *
 *   * the **identity digest** reuses the Phase 3 canonicalisation, so an
 *     invoice cannot have one identity off-chain and another on-chain;
 *   * the **commitment** wraps that digest with a domain separator and a schema
 *     version, which is what the contract stores;
 *   * the **entity** and **financing** handles are opaque hashes of database
 *     ids, so no raw identifier is ever published.
 */
@Injectable()
export class InvoiceCommitmentService {
  forInvoice(invoice: InvoiceIdentitySource): InvoiceCommitment {
    let canonical: string;

    try {
      canonical = canonicalIdentity({
        sellerTaxId: invoice.issuerTaxId,
        series: invoice.invoiceSeries,
        number: invoice.invoiceNumber,
        templateCode: invoice.invoiceType,
      });
    } catch (error) {
      if (error instanceof IncompleteIdentityError) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'INCOMPLETE_INVOICE_IDENTITY',
          'The invoice identity is incomplete and cannot be anchored',
          { missingFields: [...error.missingFields] },
        );
      }
      throw error;
    }

    const digest = sha256Hex(canonical);

    // The stored fingerprint is what duplicate detection already trusts. If it
    // disagrees with a fresh derivation the row was written by something other
    // than this codebase, and anchoring it would publish a commitment nothing
    // else agrees with.
    if (digest !== invoice.fingerprint) {
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INVOICE_FINGERPRINT_MISMATCH',
        'The stored invoice fingerprint does not match its identity fields',
      );
    }

    const identityDigest = `0x${digest}` as Hex;

    return {
      canonicalIdentity: canonical,
      identityDigest,
      commitment: this.commit(identityDigest),
    };
  }

  /**
   * Mirrors `commitmentFor` in the contract.
   *
   * `abi.encode` rather than `encodePacked`: fixed-width arguments make the two
   * equivalent, and the non-packed form is the one that stays unambiguous if a
   * future schema version adds a dynamic field.
   */
  commit(identityDigest: Hex): Hex {
    return keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint16' }, { type: 'bytes32' }],
        [COMMITMENT_DOMAIN, COMMITMENT_SCHEMA_VERSION, identityDigest],
      ),
    );
  }

  /** Opaque organization handle. Hides the database id behind a domain tag. */
  entityId(organizationId: string): Hex {
    return keccak256(toBytes(`${ENTITY_DOMAIN_LABEL}|${organizationId}`));
  }

  /** Opaque financing-request handle. */
  financingRef(financingRequestId: string): Hex {
    return keccak256(toBytes(`${FINANCING_REF_DOMAIN_LABEL}|${financingRequestId}`));
  }
}
