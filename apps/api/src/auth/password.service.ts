import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Promise wrapper around `crypto.scrypt`.
 *
 * Written out rather than `promisify(scryptCallback)`: `promisify` resolves to
 * the three-argument overload, which drops the cost parameters and would
 * silently hash with Node's defaults instead of ours.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

/**
 * scrypt parameters.
 *
 * N=16384, r=8 needs 128 * N * r = 16 MiB of memory per hash. That is enough
 * to make a GPU/ASIC attack expensive while staying well inside the default
 * 32 MiB `maxmem` and costing roughly 50 ms on a laptop. Raising N is the knob
 * to turn as hardware improves; the parameters are stored in the hash string
 * so old hashes keep verifying.
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const ALGORITHM = 'scrypt';

/**
 * Password hashing built on `node:crypto` rather than a native dependency.
 *
 * scrypt is memory-hard, in the same family as Argon2id for this purpose, and
 * ships with Node — so there is no prebuilt binary to trust and no build step
 * to break on a new platform. Argon2id would be a better choice if a vetted
 * binding were already in the dependency tree; adding one solely for this is
 * not worth the supply-chain surface.
 *
 * Stored format: `scrypt$N$r$p$<salt base64>$<key base64>`.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
      N,
      r: R,
      p: P,
      maxmem: 64 * 1024 * 1024,
    });

    return [ALGORITHM, N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /**
   * Returns false rather than throwing for anything malformed: a corrupted
   * hash must fail closed, not crash the request.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = this.parse(stored);

    if (parsed === null) {
      return false;
    }

    const candidate = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.key.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 64 * 1024 * 1024,
    });

    // Constant-time comparison: a length-dependent early return would leak
    // information about the stored key.
    if (candidate.length !== parsed.key.length) {
      return false;
    }

    return timingSafeEqual(candidate, parsed.key);
  }

  /**
   * Burns the same work as a real verification when the account does not
   * exist, so login latency does not reveal which emails are registered.
   */
  async simulateVerification(password: string): Promise<void> {
    await scrypt(password.normalize('NFKC'), randomBytes(SALT_LENGTH), KEY_LENGTH, {
      N,
      r: R,
      p: P,
      maxmem: 64 * 1024 * 1024,
    });
  }

  private parse(
    stored: string,
  ): { n: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
    const parts = stored.split('$');

    if (parts.length !== 6 || parts[0] !== ALGORITHM) {
      return null;
    }

    const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const n = Number(rawN);
    const r = Number(rawR);
    const p = Number(rawP);

    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return null;
    }

    try {
      const salt = Buffer.from(rawSalt, 'base64');
      const key = Buffer.from(rawKey, 'base64');

      if (salt.length === 0 || key.length === 0) {
        return null;
      }

      return { n, r, p, salt, key };
    } catch {
      return null;
    }
  }
}
