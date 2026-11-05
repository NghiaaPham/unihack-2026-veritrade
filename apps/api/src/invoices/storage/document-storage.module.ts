import { Module } from '@nestjs/common';
import { DOCUMENT_STORAGE } from './document-storage.js';
import { LocalDocumentStorage } from './local-document-storage.js';

/**
 * Binds the `DocumentStorage` interface to its implementation.
 *
 * Both the invoice module (writing an upload) and the verification module
 * (reading the stored bytes back) depend on the interface, so the binding
 * cannot live inside either of them without one importing the other. Swapping
 * in an S3-backed implementation later is a change to this file only.
 */
@Module({
  providers: [{ provide: DOCUMENT_STORAGE, useClass: LocalDocumentStorage }],
  exports: [DOCUMENT_STORAGE],
})
export class DocumentStorageModule {}
