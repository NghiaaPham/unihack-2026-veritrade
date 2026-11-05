import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * An HTTP error that carries a stable machine-readable `code`.
 *
 * `message` stays human-readable and may change; `code` is part of the API
 * contract and must not. Clients branch on `code`, log it, and translate it.
 *
 * `details` is for structured context a client can act on — an existing
 * invoice id, the list of missing fields, the offending totals. It must never
 * carry document contents or personal data.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

/** 400 — the request is well-formed HTTP but semantically wrong. */
export class InvalidRequestException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'INVALID_REQUEST', message, details);
  }
}

/** 409 — the invoice identity already exists with the same content. */
export class DuplicateInvoiceException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'DUPLICATE_INVOICE', message, details);
  }
}

/** 409 — the invoice identity exists, but the submitted content differs. */
export class ConflictingInvoiceException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'CONFLICTING_INVOICE', message, details);
  }
}

/** 422 — the document is XML, but not a format this service supports. */
export class UnsupportedInvoiceFormatException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, 'UNSUPPORTED_INVOICE_FORMAT', message, details);
  }
}

/** 422 — the document is a supported format but cannot be parsed or is invalid. */
export class InvalidInvoiceDocumentException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, 'INVALID_INVOICE_DOCUMENT', message, details);
  }
}

/** 413 — the upload exceeds the configured limit. */
export class DocumentTooLargeException extends AppException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(413, 'DOCUMENT_TOO_LARGE', message, details);
  }
}
