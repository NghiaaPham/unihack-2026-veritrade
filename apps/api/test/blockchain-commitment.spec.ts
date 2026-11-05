import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, keccak256, type Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  COMMITMENT_DOMAIN,
  COMMITMENT_SCHEMA_VERSION,
  REGISTRY_ABI,
  claimStatusOf,
} from '../src/blockchain/blockchain.constants.js';
import { AvalancheRpcService } from '../src/blockchain/avalanche-rpc.service.js';
import { InvoiceCommitmentService } from '../src/blockchain/invoice-commitment.service.js';
import { canonicalIdentity, sha256Hex } from '../src/invoices/invoice-fingerprint.js';
import { makeInvoice } from './invoice-fixtures.js';

const service = new InvoiceCommitmentService();

/** An invoice whose fingerprint matches its identity fields. */
function invoice(overrides: Partial<Parameters<typeof makeInvoice>[0]> = {}) {
  const base = makeInvoice(overrides);
  const fingerprint = sha256Hex(
    canonicalIdentity({
      sellerTaxId: base.issuerTaxId,
      series: base.invoiceSeries,
      number: base.invoiceNumber,
      templateCode: base.invoiceType,
    }),
  );

  return { ...base, fingerprint };
}

describe('invoice commitment', () => {
  it('derives a commitment that matches the documented encoding', () => {
    const result = service.forInvoice(invoice());

    const expected = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint16' }, { type: 'bytes32' }],
        [COMMITMENT_DOMAIN, COMMITMENT_SCHEMA_VERSION, result.identityDigest],
      ),
    );

    expect(result.commitment).toBe(expected);
    expect(result.commitment).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('reuses the Phase 3 fingerprint as the identity digest', () => {
    const row = invoice();
    const result = service.forInvoice(row);

    expect(result.identityDigest).toBe(`0x${row.fingerprint}`);
    expect(result.canonicalIdentity).toBe(
      canonicalIdentity({
        sellerTaxId: row.issuerTaxId,
        series: row.invoiceSeries,
        number: row.invoiceNumber,
        templateCode: row.invoiceType,
      }),
    );
  });

  it('is deterministic for the same invoice and different for a different number', () => {
    const a = service.forInvoice(invoice());
    const b = service.forInvoice(invoice());
    const c = service.forInvoice(invoice({ invoiceNumber: '999' }));

    expect(a.commitment).toBe(b.commitment);
    expect(a.commitment).not.toBe(c.commitment);
  });

  it('does not publish the fingerprint itself', () => {
    const row = invoice();
    const result = service.forInvoice(row);

    // Domain separation: the on-chain value is not the database value.
    expect(result.commitment).not.toBe(`0x${row.fingerprint}`);
  });

  it('refuses an invoice whose stored fingerprint disagrees with its fields', () => {
    const row = invoice();

    expect(() => service.forInvoice({ ...row, fingerprint: 'c'.repeat(64) })).toThrowError(
      expect.objectContaining({ code: 'INVOICE_FINGERPRINT_MISMATCH' }),
    );
  });

  it('refuses an incomplete identity', () => {
    const row = invoice();

    expect(() =>
      service.forInvoice({ ...row, invoiceNumber: '   ', fingerprint: row.fingerprint }),
    ).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_INVOICE_IDENTITY' }));
  });

  it('derives opaque, distinct entity and financing handles', () => {
    const orgA = service.entityId('01930000-0000-7000-8000-0000000000aa');
    const orgB = service.entityId('01930000-0000-7000-8000-0000000000bb');
    const ref = service.financingRef('01930000-0000-7000-8000-0000000000cc');

    expect(orgA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orgA).not.toBe(orgB);
    expect(orgA).not.toBe(ref);
    expect(service.entityId('01930000-0000-7000-8000-0000000000aa')).toBe(orgA);
  });
});

describe('claim status mapping', () => {
  it('maps the contract enum in declaration order', () => {
    expect(claimStatusOf(0)).toBe('UNREGISTERED');
    expect(claimStatusOf(1)).toBe('RESERVED');
    expect(claimStatusOf(2)).toBe('FINANCED');
    expect(claimStatusOf(3)).toBe('CLOSED');
  });

  it('treats an out-of-range value as unregistered rather than inventing a state', () => {
    expect(claimStatusOf(9)).toBe('UNREGISTERED');
  });
});

describe('ABI slice', () => {
  const artifactPath = fileURLToPath(
    new URL(
      '../../../packages/contracts/artifacts/contracts/VeriTradeInvoiceRegistry.sol/VeriTradeInvoiceRegistry.json',
      import.meta.url,
    ),
  );

  it('matches the compiled contract', () => {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi };

    const artifactNames = new Set(
      artifact.abi
        .filter((entry) => entry.type === 'function' || entry.type === 'event')
        .map((entry) => `${entry.type}:${entry.name}`),
    );

    for (const entry of REGISTRY_ABI) {
      if (entry.type !== 'function' && entry.type !== 'event') continue;
      expect(
        artifactNames.has(`${entry.type}:${entry.name}`),
        `${entry.type} ${entry.name} is not in the compiled artifact`,
      ).toBe(true);
    }
  });

  it('uses the same domain separator as the contract', () => {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi };
    const domainConstant = artifact.abi.find(
      (entry) => entry.type === 'function' && entry.name === 'COMMITMENT_DOMAIN',
    );

    // The contract exposes it as a view; the value itself is a keccak of the
    // documented label. Pinning the label here catches a rename on either side.
    expect(domainConstant).toBeDefined();
    expect(COMMITMENT_DOMAIN).toBe(keccak256(new TextEncoder().encode('vt-invoice-commitment-v1')));
  });
});

describe('commitment golden vector', () => {
  /**
   * A fixed invoice, hashed once and pinned.
   *
   * If any of these values changes, every invoice already anchored becomes
   * unlinkable to its new commitment. That is a schema version bump with a
   * migration plan, not a refactor, so the test exists to make the change loud.
   */
  it('has not changed since the spec was written', () => {
    const canonical = canonicalIdentity({
      sellerTaxId: '0101234567',
      series: 'C25TAA',
      number: '123',
      templateCode: '1',
    });

    expect(canonical).toBe('vt-invoice-identity-v2|0101234567|C25TAA|123|1');

    const digest = sha256Hex(canonical);
    expect(digest).toBe('29998ac48aaff1d3dc87b20184e2e87ad2c7cd1731107c481757da7326337d3e');

    expect(service.commit(`0x${digest}`)).toBe(
      '0x3583e5de82256c927d1d69598a5d6baff387dd3aa75765f857571c54f7741692',
    );
  });

  it('pins the domain separator and opaque handles', () => {
    expect(COMMITMENT_DOMAIN).toBe(
      '0x6a10b7f10cf6b56bfb7a4df8349afe719b56801a461215723f1701389e588d59',
    );
    expect(service.entityId('01930000-0000-7000-8000-0000000000aa')).toBe(
      '0x6798b8a6ce9e1e69b2b13b19008ab90c7fb3afd9f9f21688ac650d9f58d52629',
    );
    expect(service.financingRef('01930000-0000-7000-8000-0000000000cc')).toBe(
      '0xd86a6a4abd386c5e417ac0ceb86d44eda49a08cbf827d652701cb36822a199db',
    );
  });
});

describe('rpc configuration', () => {
  it('is unconfigured without a registry address', () => {
    const service = new AvalancheRpcService(new ConfigService({}));

    expect(service.configured).toBe(false);
    expect(service.writable).toBe(false);
    expect(() => service.requireContractAddress()).toThrowError(
      expect.objectContaining({ code: 'BLOCKCHAIN_NOT_CONFIGURED' }),
    );
  });

  it('is read-only without a signing key', () => {
    const service = new AvalancheRpcService(
      new ConfigService({
        AVALANCHE_CHAIN_ID: 43113,
        VERITRADE_CONTRACT_ADDRESS: `0x${'11'.repeat(20)}`,
      }),
    );

    expect(service.configured).toBe(true);
    expect(service.writable).toBe(false);
    expect(() => service.signer()).toThrowError(
      expect.objectContaining({ code: 'BLOCKCHAIN_SIGNER_NOT_CONFIGURED' }),
    );
  });

  it('selects the local chain when configured for 31337', () => {
    const service = new AvalancheRpcService(new ConfigService({ AVALANCHE_CHAIN_ID: 31337 }));

    expect(service.chainId).toBe(31337);
    expect(service.chain.id).toBe(31337);
  });
});
