import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DocumentStorage } from './document-storage.js';

/**
 * Two hex characters, then the full hash, then `.xml`.
 *
 * The two-character fan-out keeps any single directory from holding every
 * document, which matters on filesystems that degrade with large directories.
 */
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.xml$/;

/**
 * Filesystem storage for development.
 *
 * Two deliberate constraints:
 *
 *   1. **Keys are derived, never supplied.** A key is computed from the
 *      content hash, and `get` refuses anything that does not match the exact
 *      expected shape. That closes path traversal without a separate sanitiser:
 *      there is no code path where a caller-controlled string reaches `join`.
 *
 *   2. **The directory is outside the repository's tracked files** and
 *      git-ignored. Invoice XML contains buyer and seller names and tax ids;
 *      committing one by accident would be a data leak with a very long tail.
 *
 * This is not a production store. It has no encryption at rest, no retention
 * policy, no replication and no access control beyond the process's own
 * permissions. docs/invoice-security.md lists what a real deployment needs.
 */
@Injectable()
export class LocalDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(LocalDocumentStorage.name);
  private readonly rootDirectory: string;

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('INVOICE_STORAGE_DIR') ?? 'var/invoices';

    this.rootDirectory = resolve(process.cwd(), configured);

    // Logged once at startup: "where did that document go" is the first
    // question asked when an upload cannot be re-verified, and the answer is
    // a working-directory-dependent path.
    this.logger.log(`Invoice documents are stored under ${this.rootDirectory}`);
  }

  async put(contentSha256: string, data: Buffer): Promise<string> {
    const key = this.keyFor(contentSha256);
    const path = this.pathFor(key);

    await mkdir(dirname(path), { recursive: true });
    // Content-addressed: re-writing identical bytes is a no-op in effect.
    await writeFile(path, data, { mode: 0o600 });

    return key;
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.pathFor(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  private keyFor(contentSha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
      // A non-hex hash would escape the key grammar, so it never reaches disk.
      throw new Error('Refusing to store a document with a malformed content hash');
    }

    return `${contentSha256.slice(0, 2)}/${contentSha256}.xml`;
  }

  private pathFor(storageKey: string): string {
    if (!KEY_PATTERN.test(storageKey)) {
      throw new Error('Refusing to resolve a storage key outside the document directory');
    }

    return join(this.rootDirectory, storageKey);
  }

  /** Directory the instance is writing to. Logged at startup for operator sanity. */
  describe(): string {
    return this.rootDirectory;
  }
}
