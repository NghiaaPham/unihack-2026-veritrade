import { Injectable } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import {
  CHECK_KEYS,
  type CheckOutcome,
  type VerificationCheck,
  type VerificationInput,
} from './check.types.js';

/**
 * Bounds the work an attacker can force by shipping a document full of
 * signatures.
 */
const MAX_SIGNATURES = 5;

/**
 * `@xmldom/xmldom` types its DOM objects against the global DOM lib rather
 * than exporting them, so `Document` and `Element` are the ambient types here.
 */
function localNameOf(element: Element): string {
  return element.localName ?? element.nodeName.split(':').pop() ?? element.nodeName;
}

function findElements(root: Document | Element, name: string): Element[] {
  const all = root.getElementsByTagName('*');
  const found: Element[] = [];

  for (let index = 0; index < all.length; index += 1) {
    const element = all.item(index);

    if (element !== null && localNameOf(element) === name) {
      found.push(element);
    }
  }

  return found;
}

interface SignatureOutcome {
  valid: boolean;
  reason: 'VERIFIED' | 'INVALID' | 'NO_CERTIFICATE' | 'ERROR';
  algorithm?: string;
  referenceCount?: number;
}

/**
 * XMLDSig verification.
 *
 * ## What this proves, and what it does not
 *
 * A passing result proves two things: the signed element's digest matches the
 * document, and the signature over that digest validates against the
 * certificate embedded in the document. It does **not** prove the certificate
 * belongs to the seller, that it was valid at signing time, or that the
 * invoice was approved by anyone. Those are the trust-chain check
 * (`signature.trust`) and the authority check (`authority.tax`), both of which
 * report honestly that they are not performed.
 *
 * Parsing XML and verifying a signature are different operations and are
 * deliberately separate checks: a document can be perfectly well-formed and
 * completely unsigned, which is the normal case for a PDF-converted invoice.
 */
@Injectable()
export class XmlSignatureCheck implements VerificationCheck {
  readonly key = CHECK_KEYS.signature;
  readonly label = 'XML digital signature';

  async run(input: VerificationInput): Promise<CheckOutcome> {
    if (input.xml === null) {
      return {
        status: 'NOT_CHECKED',
        message: 'The invoice has no source document, so there is no signature to verify',
      };
    }

    const xmlText = input.xml.toString('utf8');
    let document: Document;

    try {
      // Warnings and recoverable errors are suppressed: they are noise on an
      // otherwise usable document. A fatal error still throws, which is the
      // case handled below.
      document = new DOMParser({
        errorHandler: {
          warning: () => undefined,
          error: () => undefined,
        },
      }).parseFromString(xmlText, 'text/xml');
    } catch {
      return {
        status: 'ERROR',
        message: 'The document could not be loaded for signature verification',
      };
    }

    const signatures = findElements(document, 'Signature');

    if (signatures.length === 0) {
      return {
        status: 'NOT_CHECKED',
        message: 'The document carries no XML digital signature',
        details: { signatureCount: 0 },
      };
    }

    if (signatures.length > MAX_SIGNATURES) {
      return {
        status: 'UNSUPPORTED',
        message: `The document contains more than ${MAX_SIGNATURES} signatures, which is not supported`,
        details: { signatureCount: signatures.length },
      };
    }

    const outcomes = signatures.map((node) => this.verifyOne(node, xmlText));

    const invalid = outcomes.filter((outcome) => outcome.reason === 'INVALID');
    const errored = outcomes.filter((outcome) => outcome.reason === 'ERROR');
    const withoutCertificate = outcomes.filter((outcome) => outcome.reason === 'NO_CERTIFICATE');

    if (invalid.length > 0) {
      return {
        status: 'FAILED',
        message: 'At least one XML signature does not match the document',
        details: { signatureCount: signatures.length, invalid: invalid.length },
      };
    }

    if (errored.length > 0) {
      return {
        status: 'ERROR',
        message: 'At least one XML signature could not be processed',
        details: { signatureCount: signatures.length, errored: errored.length },
      };
    }

    if (withoutCertificate.length > 0) {
      return {
        status: 'UNSUPPORTED',
        message:
          'The signature does not embed an X.509 certificate and no external trust anchor is configured',
        details: {
          signatureCount: signatures.length,
          withoutCertificate: withoutCertificate.length,
        },
      };
    }

    return {
      status: 'PASSED',
      message: 'Every XML signature validates against its embedded certificate',
      details: {
        signatureCount: signatures.length,
        algorithms: [...new Set(outcomes.map((outcome) => outcome.algorithm))],
        referenceCounts: outcomes.map((outcome) => outcome.referenceCount ?? 0),
        // Stated explicitly so a client cannot mistake a cryptographic pass
        // for a statement about who the signer is.
        trustChain: 'NOT_CHECKED',
      },
    };
  }

  private verifyOne(node: Element, xmlText: string): SignatureOutcome {
    try {
      const [keyInfo] = findElements(node, 'KeyInfo');
      const certificate = SignedXml.getCertFromKeyInfo(keyInfo ?? null);

      if (certificate === null) {
        return { valid: false, reason: 'NO_CERTIFICATE' };
      }

      const signature = new SignedXml({ publicCert: certificate });
      signature.loadSignature(node);

      // `checkSignature` throws for structural problems (unresolvable
      // reference, unsupported transform) and returns false for a bad digest.
      const valid = signature.checkSignature(xmlText);

      return {
        valid,
        reason: valid ? 'VERIFIED' : 'INVALID',
        algorithm: signature.signatureAlgorithm,
        referenceCount: signature.getReferences().length,
      };
    } catch {
      // The thrown message can quote document content, so it is discarded.
      return { valid: false, reason: 'ERROR' };
    }
  }
}
