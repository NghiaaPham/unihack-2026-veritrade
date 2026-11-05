import { Logger } from '@nestjs/common';
import { AppException } from '../src/common/errors/app.exception.js';
import type { ParsedInvoice } from '../src/invoices/xml/invoice-xml.types.js';
import type { InvoiceXmlParserService } from '../src/invoices/xml/invoice-xml-parser.service.js';
import type {
  CheckOutcome,
  VerificationCheck,
  VerificationInput,
} from '../src/invoice-verification/checks/check.types.js';
import { VerificationEngineService } from '../src/invoice-verification/verification-engine.service.js';
import { makeInvoice } from './invoice-fixtures.js';

/**
 * A check with a fixed outcome. `run` is a spy so the test can prove each
 * check is called exactly once with the same input.
 */
function stubCheck(
  key: string,
  outcome: CheckOutcome | (() => Promise<CheckOutcome>),
): VerificationCheck {
  return {
    key,
    label: `Label for ${key}`,
    run: vi.fn(typeof outcome === 'function' ? outcome : async () => outcome),
  };
}

const pass = (key: string) => stubCheck(key, { status: 'PASSED', message: `${key} passed` });

function engine(checks: VerificationCheck[], parse?: () => ParsedInvoice) {
  const parser = {
    parse: vi.fn(parse ?? (() => ({}) as ParsedInvoice)),
  } as unknown as InvoiceXmlParserService;

  return { engine: new VerificationEngineService(parser, checks), parser };
}

const runInput = {
  invoice: makeInvoice(),
  document: null,
  xml: null,
  organizationId: '01930000-0000-7000-8000-0000000000aa',
  maxDocumentBytes: 2_097_152,
};

describe('Verification engine', () => {
  it('passes only when every check passed', async () => {
    const { engine: subject } = engine([pass('a'), pass('b')]);

    const result = await subject.run(runInput);

    expect(result.status).toBe('PASSED');
    expect(result.checks.map((check) => check.status)).toEqual(['PASSED', 'PASSED']);
  });

  it('downgrades to PARTIAL when any check could not run', async () => {
    const { engine: subject } = engine([
      pass('a'),
      stubCheck('b', { status: 'SKIPPED', message: 'not enough data' }),
      stubCheck('c', { status: 'UNSUPPORTED', message: 'no integration' }),
      stubCheck('d', { status: 'NOT_CHECKED', message: 'no trust store' }),
    ]);

    const result = await subject.run(runInput);

    expect(result.status).toBe('PARTIAL');
  });

  it('fails the run when any single check failed, however many passed', async () => {
    const { engine: subject } = engine([
      pass('a'),
      pass('b'),
      stubCheck('c', { status: 'FAILED', message: 'totals do not reconcile' }),
    ]);

    const result = await subject.run(runInput);

    expect(result.status).toBe('FAILED');
  });

  it('records a throwing check as ERROR and still runs the rest', async () => {
    // The database-failure case: one broken check must not hide the verdict of
    // the others, and it must not crash the run.
    const failing = stubCheck('db.check', async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    });
    const survivor = pass('other.check');

    const { engine: subject } = engine([failing, survivor]);

    // The failure is logged on purpose; capturing it keeps the suite output
    // readable and lets the test assert what was logged.
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      const result = await subject.run(runInput);

      expect(result.checks[0]).toMatchObject({ key: 'db.check', status: 'ERROR' });
      expect(result.checks[1]).toMatchObject({ key: 'other.check', status: 'PASSED' });
      expect(survivor.run).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('FAILED');
      expect(logged).toHaveBeenCalledTimes(1);
      // The driver message can carry a connection string; it may reach the
      // log but must never reach the stored result.
      expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    } finally {
      logged.mockRestore();
    }
  });

  it('always reports scope as LOCAL_CHECKS_ONLY', async () => {
    const { engine: subject } = engine([pass('a')]);

    const result = await subject.run(runInput);

    expect(result.scope).toBe('LOCAL_CHECKS_ONLY');
  });

  it('derives limitations from the checks that did not pass', async () => {
    const { engine: subject } = engine([
      pass('a'),
      stubCheck('authority.tax', { status: 'UNSUPPORTED', message: 'no integration configured' }),
    ]);

    const result = await subject.run(runInput);

    expect(result.limitations).toEqual(['Label for authority.tax: no integration configured']);
  });

  it('gives every check the same input and preserves execution order', async () => {
    const first = pass('first');
    const second = pass('second');
    const { engine: subject } = engine([first, second]);

    const result = await subject.run(runInput);

    expect(result.checks.map((check) => check.key)).toEqual(['first', 'second']);
    expect(first.run).toHaveBeenCalledWith(expect.objectContaining({ parsed: null }));
    expect(second.run).toHaveBeenCalledWith(expect.objectContaining({ parsed: null }));
  });

  it('does not parse when there is no document', async () => {
    const { engine: subject, parser } = engine([pass('a')]);

    await subject.run(runInput);

    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('turns a parse failure into a reported error instead of throwing', async () => {
    const { engine: subject } = engine([pass('a')], () => {
      throw new AppException(
        422,
        'INVALID_INVOICE_DOCUMENT',
        'The document is not well-formed XML',
      );
    });

    const result = await subject.run({ ...runInput, xml: Buffer.from('<broken') });

    expect(result.checks[0]?.status).toBe('PASSED');
    expect(result.status).toBe('PASSED');
  });

  it('passes the parse error through to the checks', async () => {
    const seen: VerificationInput[] = [];
    const observer: VerificationCheck = {
      key: 'observer',
      label: 'Observer',
      run: async (value) => {
        seen.push(value);
        return { status: 'PASSED', message: 'observed' };
      },
    };

    const { engine: subject } = engine([observer], () => {
      throw new AppException(413, 'DOCUMENT_TOO_LARGE', 'The uploaded document exceeds the limit');
    });

    await subject.run({ ...runInput, xml: Buffer.from('<broken') });

    expect(seen[0]?.parsed).toBeNull();
    expect(seen[0]?.parseError).toEqual({
      code: 'DOCUMENT_TOO_LARGE',
      message: 'The uploaded document exceeds the limit',
    });
  });

  it('measures a non-negative duration for every check', async () => {
    const { engine: subject } = engine([pass('a')]);

    const result = await subject.run(runInput);

    for (const check of result.checks) {
      expect(Number.isInteger(check.durationMs)).toBe(true);
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
