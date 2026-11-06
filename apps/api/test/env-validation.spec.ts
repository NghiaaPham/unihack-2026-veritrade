import { afterEach, describe, expect, it } from 'vitest';

import { validateEnvironment } from '../src/config/env.validation.js';

/**
 * The environment contract is fail-fast: a malformed or unsafe configuration
 * must abort bootstrap rather than let the API drift toward the wrong network
 * or a signing key without an explicit target.
 */
const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://veritrade:veritrade@localhost:5432/veritrade',
  JWT_SECRET: 'a'.repeat(32),
  AVALANCHE_CHAIN_ID: 31337,
  CORS_ORIGIN: 'http://localhost:3000',
};

function valid(raw: Record<string, unknown> = {}): ReturnType<typeof validateEnvironment> {
  return validateEnvironment({ ...base, ...raw });
}

describe('validateEnvironment — chain id and signing guard', () => {
  it('accepts an explicit chain id without a signing key', () => {
    const env = valid({ AVALANCHE_CHAIN_ID: 43113 });
    expect(env.AVALANCHE_CHAIN_ID).toBe(43113);
  });

  it('rejects a chain id outside the supported set (mainnet)', () => {
    expect(() => valid({ AVALANCHE_CHAIN_ID: 43114 })).toThrowError(/AVALANCHE_CHAIN_ID/);
  });

  it('requires an explicit chain id when a signing key is present', () => {
    // The 43113 default must not silently apply to a deployment that can sign.
    // Start from base and explicitly drop AVALANCHE_CHAIN_ID so it is absent
    // (spread would otherwise carry base's 31337 value).
    const withoutChainId: Record<string, unknown> = { ...base };
    delete withoutChainId.AVALANCHE_CHAIN_ID;
    expect(() =>
      validateEnvironment({
        ...withoutChainId,
        AVALANCHE_DEPLOYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
      }),
    ).toThrowError(/AVALANCHE_CHAIN_ID must be set explicitly/);
  });

  it('accepts an explicit chain id together with a signing key', () => {
    const env = valid({
      AVALANCHE_CHAIN_ID: 43113,
      AVALANCHE_DEPLOYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
    });

    expect(env.AVALANCHE_CHAIN_ID).toBe(43113);
    expect(env.AVALANCHE_DEPLOYER_PRIVATE_KEY).toBe('0x' + '1'.repeat(64));
  });

  it('does not require an explicit chain id when no signing key is set', () => {
    // A read-only deployment (no key) is allowed to rely on the default, since
    // it cannot broadcast regardless of which chain it points at.
    const env = validateEnvironment({ ...base, AVALANCHE_CHAIN_ID: undefined });
    expect(env.AVALANCHE_CHAIN_ID).toBe(43113);
  });
});

describe('validateEnvironment — other invariants', () => {
  afterEach(() => {
    delete process.env.AVALANCHE_DEPLOYER_PRIVATE_KEY;
  });

  it('rejects a malformed signing key', () => {
    expect(() => valid({ AVALANCHE_DEPLOYER_PRIVATE_KEY: 'not-a-key' })).toThrowError(
      /AVALANCHE_DEPLOYER_PRIVATE_KEY/,
    );
  });

  it('rejects a plaintext (non-https) RPC url off the local chain', () => {
    expect(() =>
      valid({ AVALANCHE_CHAIN_ID: 43113, AVALANCHE_RPC_URL: 'http://evil.example/rpc' }),
    ).toThrowError(/AVALANCHE_RPC_URL/);
  });

  it('allows a plaintext RPC url on the local chain', () => {
    const env = valid({ AVALANCHE_CHAIN_ID: 31337, AVALANCHE_RPC_URL: 'http://127.0.0.1:8545' });
    expect(env.AVALANCHE_RPC_URL).toBe('http://127.0.0.1:8545');
  });

  it('rejects an invalid contract address', () => {
    expect(() => valid({ VERITRADE_CONTRACT_ADDRESS: '0xnope' })).toThrowError(
      /VERITRADE_CONTRACT_ADDRESS/,
    );
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => valid({ JWT_SECRET: 'short' })).toThrowError(/JWT_SECRET/);
  });
});
