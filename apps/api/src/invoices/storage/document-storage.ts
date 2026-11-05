export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

/**
 * Where uploaded invoice documents live.
 *
 * The interface exists so the database never holds a document body and the
 * application never depends on a filesystem path. `LocalDocumentStorage` is a
 * development implementation; production needs an object store (see
 * docs/invoice-security.md for the requirements it must meet).
 *
 * Keys are content-addressed, which makes `put` idempotent: writing the same
 * bytes twice is the same operation, so a retried upload cannot corrupt
 * anything or leave two copies.
 */
export interface DocumentStorage {
  /** Stores the bytes and returns the key to record on the invoice document. */
  put(contentSha256: string, data: Buffer): Promise<string>;
  /** Reads the bytes back. Throws when the key is unknown. */
  get(storageKey: string): Promise<Buffer>;
  exists(storageKey: string): Promise<boolean>;
}
