import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { network } from 'hardhat';
import {
  encodeAbiParameters,
  keccak256,
  parseEventLogs,
  type Abi,
  type Hex,
  type TransactionReceipt,
} from 'viem';

/**
 * Tests for VeriTradeInvoiceRegistry.
 *
 * The suite is organised around the fourteen required cases plus the five
 * invariants from the Phase 4 specification. Every test deploys a fresh
 * registry so no state leaks between cases.
 *
 * Reverts are asserted by custom-error name rather than by message text: the
 * name is part of the ABI and survives compiler and toolchain upgrades, while
 * the message is not.
 */

const connection = await network.getOrCreate();
const { viem } = connection;
const publicClient = await viem.getPublicClient();

const wallets = await viem.getWalletClients();

function wallet(index: number) {
  const found = wallets[index];
  assert.ok(found !== undefined, `expected a wallet at index ${index}`);
  return found;
}

const admin = wallet(0);
const registrar = wallet(1);
const financier = wallet(2);
const outsider = wallet(3);
const secondFinancier = wallet(4);

/** A stable, non-zero commitment used where the identity itself is irrelevant. */
function commitment(seed: string): Hex {
  return keccak256(new TextEncoder().encode(seed));
}

function entity(seed: string): Hex {
  return keccak256(new TextEncoder().encode(`entity:${seed}`));
}

/**
 * Walks the viem error chain looking for a decoded custom error name.
 * viem nests the decoded revert under `cause` several levels deep, so a single
 * property read is not enough.
 */
function revertNames(error: unknown): string[] {
  const names: string[] = [];
  let cursor: unknown = error;
  const seen = new Set<unknown>();

  while (cursor !== null && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    const candidate = cursor as { data?: { errorName?: unknown }; errorName?: unknown };
    if (typeof candidate.data?.errorName === 'string') names.push(candidate.data.errorName);
    if (typeof candidate.errorName === 'string') names.push(candidate.errorName);
    cursor = (cursor as { cause?: unknown }).cause;
  }

  return names;
}

async function expectRevert(action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const names = revertNames(error);
    assert.ok(
      names.includes(expected),
      `expected revert ${expected}, observed [${names.join(', ') || 'no decoded error'}]: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  assert.fail(`expected revert ${expected}, but the call succeeded`);
}

async function send(hash: Promise<Hex>): Promise<TransactionReceipt> {
  return publicClient.waitForTransactionReceipt({ hash: await hash });
}

async function deployRegistry() {
  const registry = await viem.deployContract('VeriTradeInvoiceRegistry', [admin.account.address]);
  const registrarRole = await registry.read.REGISTRAR_ROLE();
  const financierRole = await registry.read.FINANCIER_ROLE();

  await send(
    registry.write.grantRole([registrarRole, registrar.account.address], {
      account: admin.account,
    }),
  );
  await send(
    registry.write.grantRole([financierRole, financier.account.address], {
      account: admin.account,
    }),
  );

  return { registry, registrarRole, financierRole };
}

/** Decodes the named events out of a receipt, in log order. */
function eventsOf(
  abi: Abi,
  receipt: TransactionReceipt,
  name: string,
): { args: Record<string, unknown> }[] {
  const parsed = parseEventLogs({ abi, logs: receipt.logs });
  return parsed
    .filter((log) => log.eventName === name)
    .map((log) => ({ args: log.args as unknown as Record<string, unknown> }));
}

describe('VeriTradeInvoiceRegistry', () => {
  describe('registration', () => {
    it('reserves an invoice and records the submitting entity', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-1');
      const org = entity('seller-a');

      await send(registry.write.register([key, org], { account: registrar.account }));

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 1, 'status should be RESERVED');
      assert.equal(claim.generation, 1);
      assert.equal(claim.schemaVersion, 1);
      assert.equal(claim.entityId, org);
      assert.equal(claim.registrar.toLowerCase(), registrar.account.address.toLowerCase());
      assert.equal(claim.financier, '0x0000000000000000000000000000000000000000');
      assert.ok(claim.reservedAt > 0n);
      assert.equal(await registry.read.statusOf([key]), 1);
      assert.equal(await registry.read.isActive([key]), true);
    });

    it('rejects a second active registration of the same commitment', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-2');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      await expectRevert(
        () => registry.write.register([key, entity('seller-a')], { account: registrar.account }),
        'ClaimAlreadyActive',
      );

      // The failed attempt must not have disturbed the original claim.
      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.generation, 1);
      assert.equal(claim.status, 1);
    });

    it('rejects registration from an address without REGISTRAR_ROLE', async () => {
      const { registry } = await deployRegistry();

      await expectRevert(
        () =>
          registry.write.register([commitment('invoice-3'), entity('seller-a')], {
            account: outsider.account,
          }),
        'AccessControlUnauthorizedAccount',
      );

      assert.equal(await registry.read.statusOf([commitment('invoice-3')]), 0);
    });

    it('rejects zero commitment and zero entity', async () => {
      const { registry } = await deployRegistry();

      await expectRevert(
        () =>
          registry.write.register([`0x${'00'.repeat(32)}`, entity('seller-a')], {
            account: registrar.account,
          }),
        'ZeroCommitment',
      );
      await expectRevert(
        () =>
          registry.write.register([commitment('invoice-4'), `0x${'00'.repeat(32)}`], {
            account: registrar.account,
          }),
        'ZeroEntityId',
      );
    });
  });

  describe('financing lifecycle', () => {
    it('declares financing on a reserved invoice', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-5');
      const ref = commitment('financing-request-5');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.declareFinanced([key, ref], { account: financier.account }));

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 2, 'status should be FINANCED');
      assert.equal(claim.financingRef, ref);
      assert.equal(claim.financier.toLowerCase(), financier.account.address.toLowerCase());
      assert.ok(claim.financedAt >= claim.reservedAt);
      assert.equal(await registry.read.isActive([key]), true);
    });

    it('rejects a repeated financing declaration', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-6');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-a')], { account: financier.account }),
      );

      await expectRevert(
        () =>
          registry.write.declareFinanced([key, commitment('ref-b')], {
            account: financier.account,
          }),
        'NotReserved',
      );

      // The first declaration is untouched by the rejected one.
      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.financingRef, commitment('ref-a'));
    });

    it('rejects financing for an unregistered commitment', async () => {
      const { registry } = await deployRegistry();

      await expectRevert(
        () =>
          registry.write.declareFinanced([commitment('invoice-7'), commitment('ref-7')], {
            account: financier.account,
          }),
        'NotReserved',
      );
    });

    it('rejects financing from an address without FINANCIER_ROLE', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-8');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      await expectRevert(
        () =>
          registry.write.declareFinanced([key, commitment('ref-8')], {
            account: registrar.account,
          }),
        'AccessControlUnauthorizedAccount',
      );
      assert.equal(await registry.read.statusOf([key]), 1);
    });

    it('rejects a zero financing reference', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-9');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      await expectRevert(
        () =>
          registry.write.declareFinanced([key, `0x${'00'.repeat(32)}`], {
            account: financier.account,
          }),
        'ZeroFinancingRef',
      );
    });
  });

  describe('cancellation', () => {
    it('cancels a reservation without marking the invoice as financed', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-10');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.cancelReservation([key], { account: registrar.account }));

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 0, 'status should be UNREGISTERED');
      assert.equal(claim.financier, '0x0000000000000000000000000000000000000000');
      assert.equal(claim.financedAt, 0n);
      assert.equal(await registry.read.isActive([key]), false);
    });

    it('refuses to cancel a financed claim', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-11');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-11')], { account: financier.account }),
      );

      await expectRevert(
        () => registry.write.cancelReservation([key], { account: registrar.account }),
        'NotReserved',
      );
      assert.equal(await registry.read.statusOf([key]), 2);
    });

    it('refuses to cancel an unknown commitment', async () => {
      const { registry } = await deployRegistry();

      await expectRevert(
        () =>
          registry.write.cancelReservation([commitment('never-registered')], {
            account: registrar.account,
          }),
        'NotReserved',
      );
    });
  });

  describe('closing', () => {
    it('closes a financed claim and keeps the financing record intact', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-12');
      const ref = commitment('ref-12');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.declareFinanced([key, ref], { account: financier.account }));
      await send(registry.write.closeClaim([key], { account: financier.account }));

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 3, 'status should be CLOSED');
      assert.equal(claim.financingRef, ref, 'closing must not erase the financing reference');
      assert.equal(claim.financier.toLowerCase(), financier.account.address.toLowerCase());
      assert.ok(claim.closedAt >= claim.financedAt);
      assert.equal(await registry.read.isActive([key]), false);
    });

    it('refuses to close a claim that was never financed', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-13');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      await expectRevert(
        () => registry.write.closeClaim([key], { account: financier.account }),
        'NotFinanced',
      );
      assert.equal(await registry.read.statusOf([key]), 1);
    });

    it('refuses to close a claim declared by a different financier', async () => {
      const { registry, financierRole } = await deployRegistry();
      const key = commitment('invoice-14');

      await send(
        registry.write.grantRole([financierRole, secondFinancier.account.address], {
          account: admin.account,
        }),
      );
      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-14')], { account: financier.account }),
      );

      await expectRevert(
        () => registry.write.closeClaim([key], { account: secondFinancier.account }),
        'NotDeclaringFinancier',
      );
      assert.equal(await registry.read.statusOf([key]), 2);
    });

    it('lets the admin close a financed claim as a recovery path', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-15');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-15')], { account: financier.account }),
      );
      await send(registry.write.closeClaim([key], { account: admin.account }));

      assert.equal(await registry.read.statusOf([key]), 3);
    });
  });

  describe('re-registration policy', () => {
    it('allows re-registration after a cancelled reservation, with a new generation', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-16');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.cancelReservation([key], { account: registrar.account }));
      await send(
        registry.write.register([key, entity('seller-b')], { account: registrar.account }),
      );

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 1);
      assert.equal(claim.generation, 2, 'generation must advance across attempts');
      assert.equal(claim.entityId, entity('seller-b'));
    });

    it('never allows re-registration of a closed claim', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-17');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-17')], { account: financier.account }),
      );
      await send(registry.write.closeClaim([key], { account: financier.account }));

      await expectRevert(
        () => registry.write.register([key, entity('seller-b')], { account: registrar.account }),
        'ClaimIsTerminal',
      );

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 3);
      assert.equal(claim.generation, 1, 'a rejected re-registration must not mutate the claim');
      assert.equal(claim.financingRef, commitment('ref-17'));
    });
  });

  describe('cross-organization collision', () => {
    it('blocks the same commitment submitted under a different entity id', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-18');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      await expectRevert(
        () => registry.write.register([key, entity('seller-b')], { account: registrar.account }),
        'ClaimAlreadyActive',
      );

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.entityId, entity('seller-a'), 'the first submitter keeps the claim');
    });

    it('also blocks a second entity while the claim is FINANCED', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-19');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(
        registry.write.declareFinanced([key, commitment('ref-19')], { account: financier.account }),
      );

      await expectRevert(
        () => registry.write.register([key, entity('seller-b')], { account: registrar.account }),
        'ClaimAlreadyActive',
      );
    });
  });

  describe('role administration', () => {
    it('stops registration as soon as REGISTRAR_ROLE is revoked', async () => {
      const { registry, registrarRole } = await deployRegistry();
      const key = commitment('invoice-20');

      await send(
        registry.write.revokeRole([registrarRole, registrar.account.address], {
          account: admin.account,
        }),
      );

      await expectRevert(
        () => registry.write.register([key, entity('seller-a')], { account: registrar.account }),
        'AccessControlUnauthorizedAccount',
      );
      assert.equal(await registry.read.statusOf([key]), 0);
    });

    it('refuses to grant roles from an unprivileged address', async () => {
      const { registry, registrarRole } = await deployRegistry();

      await expectRevert(
        () =>
          registry.write.grantRole([registrarRole, outsider.account.address], {
            account: outsider.account,
          }),
        'AccessControlUnauthorizedAccount',
      );
    });
  });

  describe('pause', () => {
    it('blocks every transition while paused and restores them on unpause', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-21');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.pause({ account: admin.account }));
      assert.equal(await registry.read.paused(), true);

      await expectRevert(
        () =>
          registry.write.register([commitment('invoice-22'), entity('seller-a')], {
            account: registrar.account,
          }),
        'EnforcedPause',
      );
      await expectRevert(
        () =>
          registry.write.declareFinanced([key, commitment('ref-21')], {
            account: financier.account,
          }),
        'EnforcedPause',
      );
      await expectRevert(
        () => registry.write.cancelReservation([key], { account: registrar.account }),
        'EnforcedPause',
      );

      await send(registry.write.unpause({ account: admin.account }));
      await send(
        registry.write.declareFinanced([key, commitment('ref-21')], { account: financier.account }),
      );
      assert.equal(await registry.read.statusOf([key]), 2);
    });

    it('refuses to pause or unpause from an unprivileged address', async () => {
      const { registry } = await deployRegistry();

      await expectRevert(
        () => registry.write.pause({ account: outsider.account }),
        'AccessControlUnauthorizedAccount',
      );
      await send(registry.write.pause({ account: admin.account }));
      await expectRevert(
        () => registry.write.unpause({ account: registrar.account }),
        'AccessControlUnauthorizedAccount',
      );
    });
  });

  describe('events', () => {
    it('emits exactly one structured event per accepted transition', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-23');
      const org = entity('seller-a');
      const ref = commitment('ref-23');

      const reserved = await send(
        registry.write.register([key, org], { account: registrar.account }),
      );
      const [reservationEvent] = eventsOf(registry.abi, reserved, 'InvoiceReserved');
      assert.ok(reservationEvent !== undefined, 'InvoiceReserved must be emitted');
      assert.equal(reservationEvent.args.commitment, key);
      assert.equal(reservationEvent.args.entityId, org);
      assert.equal(reservationEvent.args.generation, 1);
      assert.equal(reservationEvent.args.schemaVersion, 1);

      const financed = await send(
        registry.write.declareFinanced([key, ref], { account: financier.account }),
      );
      const [financingEvent] = eventsOf(registry.abi, financed, 'FinancingDeclared');
      assert.ok(financingEvent !== undefined, 'FinancingDeclared must be emitted');
      assert.equal(financingEvent.args.commitment, key);
      assert.equal(financingEvent.args.financingRef, ref);
      assert.equal(
        String(financingEvent.args.financier).toLowerCase(),
        financier.account.address.toLowerCase(),
      );

      const closed = await send(registry.write.closeClaim([key], { account: financier.account }));
      const [closedEvent] = eventsOf(registry.abi, closed, 'ClaimClosed');
      assert.ok(closedEvent !== undefined, 'ClaimClosed must be emitted');
      assert.equal(closedEvent.args.commitment, key);
      assert.equal(closedEvent.args.generation, 1);
    });

    it('emits a cancellation event that preserves the released reservation', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-24');
      const org = entity('seller-a');

      await send(registry.write.register([key, org], { account: registrar.account }));
      const receipt = await send(
        registry.write.cancelReservation([key], { account: registrar.account }),
      );

      const [event] = eventsOf(registry.abi, receipt, 'ReservationCancelled');
      assert.ok(event !== undefined, 'ReservationCancelled must be emitted');
      assert.equal(event.args.commitment, key);
      assert.equal(event.args.entityId, org);
      assert.equal(
        String(event.args.registrar).toLowerCase(),
        registrar.account.address.toLowerCase(),
      );
      assert.equal(
        String(event.args.cancelledBy).toLowerCase(),
        registrar.account.address.toLowerCase(),
      );
      assert.equal(event.args.generation, 1);
    });

    it('emits no event when a transition is rejected', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invoice-25');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      let receipt: TransactionReceipt | undefined;
      try {
        receipt = await send(
          registry.write.register([key, entity('seller-b')], { account: registrar.account }),
        );
      } catch {
        receipt = undefined;
      }
      assert.equal(receipt, undefined, 'the duplicate registration must not be mined');
      assert.equal(await registry.read.claimOf([key]).then((c) => c.generation), 1);
    });
  });

  describe('commitment encoding', () => {
    it('matches the documented off-chain encoding', async () => {
      const { registry } = await deployRegistry();
      const digest = keccak256(new TextEncoder().encode('identity-digest'));

      const onChain = await registry.read.commitmentFor([digest]);
      const offChain = keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'uint16' }, { type: 'bytes32' }],
          [await registry.read.COMMITMENT_DOMAIN(), 1, digest],
        ),
      );

      assert.equal(onChain, offChain, 'backend and contract must derive the same commitment');
    });

    it('produces different commitments for different digests', async () => {
      const { registry } = await deployRegistry();
      const a = await registry.read.commitmentFor([commitment('digest-a')]);
      const b = await registry.read.commitmentFor([commitment('digest-b')]);
      assert.notEqual(a, b);
    });
  });

  describe('invariants', () => {
    it('invariant: at most one active claim per commitment under random operation sequences', async () => {
      const { registry } = await deployRegistry();
      const keys = Array.from({ length: 6 }, (_, index) => commitment(`fuzz-${index}`));
      const orgs = [entity('seller-a'), entity('seller-b'), entity('seller-c')];

      type State = 'UNREGISTERED' | 'RESERVED' | 'FINANCED' | 'CLOSED';
      const STATUS: Record<State, number> = {
        UNREGISTERED: 0,
        RESERVED: 1,
        FINANCED: 2,
        CLOSED: 3,
      };
      const model = new Map<string, State>(keys.map((key) => [key, 'UNREGISTERED']));

      // Deterministic LCG: reproducible on failure, no dependency needed.
      let seed = 0x2f6e2b1;
      const next = (bound: number): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed % bound;
      };

      for (let step = 0; step < 240; step += 1) {
        const key = keys[next(keys.length)];
        assert.ok(key !== undefined);
        const before = model.get(key);
        assert.ok(before !== undefined);
        const operation = next(4);

        if (operation === 0) {
          const org = orgs[next(orgs.length)];
          assert.ok(org !== undefined);
          const accepted = before === 'UNREGISTERED';
          if (accepted) {
            const receipt = await send(
              registry.write.register([key, org], { account: registrar.account }),
            );
            assert.equal(eventsOf(registry.abi, receipt, 'InvoiceReserved').length, 1);
            model.set(key, 'RESERVED');
          } else {
            await expectRevert(
              () => registry.write.register([key, org], { account: registrar.account }),
              before === 'CLOSED' ? 'ClaimIsTerminal' : 'ClaimAlreadyActive',
            );
          }
        } else if (operation === 1) {
          const accepted = before === 'RESERVED';
          if (accepted) {
            const receipt = await send(
              registry.write.declareFinanced([key, commitment(`fuzz-ref-${step}`)], {
                account: financier.account,
              }),
            );
            assert.equal(eventsOf(registry.abi, receipt, 'FinancingDeclared').length, 1);
            model.set(key, 'FINANCED');
          } else {
            await expectRevert(
              () =>
                registry.write.declareFinanced([key, commitment(`fuzz-ref-${step}`)], {
                  account: financier.account,
                }),
              'NotReserved',
            );
          }
        } else if (operation === 2) {
          const accepted = before === 'RESERVED';
          if (accepted) {
            const receipt = await send(
              registry.write.cancelReservation([key], { account: registrar.account }),
            );
            assert.equal(eventsOf(registry.abi, receipt, 'ReservationCancelled').length, 1);
            model.set(key, 'UNREGISTERED');
          } else {
            await expectRevert(
              () => registry.write.cancelReservation([key], { account: registrar.account }),
              'NotReserved',
            );
          }
        } else {
          const accepted = before === 'FINANCED';
          if (accepted) {
            const receipt = await send(
              registry.write.closeClaim([key], { account: financier.account }),
            );
            assert.equal(eventsOf(registry.abi, receipt, 'ClaimClosed').length, 1);
            model.set(key, 'CLOSED');
          } else {
            await expectRevert(
              () => registry.write.closeClaim([key], { account: financier.account }),
              'NotFinanced',
            );
          }
        }

        // The model and the chain must agree after every single step.
        for (const tracked of keys) {
          const expected = model.get(tracked);
          assert.ok(expected !== undefined);
          assert.equal(
            await registry.read.statusOf([tracked]),
            STATUS[expected],
            `state diverged for ${tracked} at step ${step}`,
          );
          assert.equal(
            await registry.read.isActive([tracked]),
            expected === 'RESERVED' || expected === 'FINANCED',
          );
        }
      }
    });

    it('invariant: unprivileged actors cannot change any state', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invariant-unauthorized');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );

      const before = await registry.read.claimOf([key]);

      await expectRevert(
        () =>
          registry.write.declareFinanced([key, commitment('ref-x')], { account: outsider.account }),
        'AccessControlUnauthorizedAccount',
      );
      await expectRevert(
        () => registry.write.cancelReservation([key], { account: outsider.account }),
        'AccessControlUnauthorizedAccount',
      );
      await expectRevert(
        () => registry.write.closeClaim([key], { account: outsider.account }),
        'NotFinanced',
      );

      const after = await registry.read.claimOf([key]);
      assert.deepEqual(after, before, 'a rejected call must leave the claim byte-identical');
    });

    it('invariant: closing preserves the full financing record', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invariant-history');
      const ref = commitment('invariant-ref');

      await send(
        registry.write.register([key, entity('seller-a')], { account: registrar.account }),
      );
      await send(registry.write.declareFinanced([key, ref], { account: financier.account }));
      const financed = await registry.read.claimOf([key]);

      await send(registry.write.closeClaim([key], { account: financier.account }));
      const closed = await registry.read.claimOf([key]);

      assert.equal(closed.reservedAt, financed.reservedAt);
      assert.equal(closed.financedAt, financed.financedAt);
      assert.equal(closed.financier, financed.financier);
      assert.equal(closed.financingRef, financed.financingRef);
      assert.equal(closed.entityId, financed.entityId);
      assert.equal(closed.registrar, financed.registrar);
      assert.ok(closed.closedAt > 0n);
    });

    it('invariant: an unknown commitment is inert', async () => {
      const { registry } = await deployRegistry();
      const key = commitment('invariant-unknown');

      const claim = await registry.read.claimOf([key]);
      assert.equal(claim.status, 0);
      assert.equal(claim.generation, 0);
      assert.equal(await registry.read.isActive([key]), false);
    });
  });
});
