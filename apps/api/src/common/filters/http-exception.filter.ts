import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Maps a status code to a stable default `code` when the thrower did not
 * supply one. Nest's built-in exceptions (`NotFoundException`,
 * `ValidationPipe`'s `BadRequestException`, ...) predate `AppException`, and
 * they must still produce a usable machine-readable code.
 */
const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

export interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string | string[];
  details?: Record<string, unknown>;
  timestamp: string;
  path: string;
}

/**
 * Multer reports an upload that broke a limit by throwing a plain `Error`
 * subclass with a `code`, which Nest does not translate. Left alone it would
 * become a 500, so the two codes a client can actually cause are mapped here.
 *
 * The mapping lives in the filter rather than in the controller because the
 * throw happens inside the interceptor, before the handler runs.
 */
const MULTER_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  LIMIT_FILE_SIZE: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    code: 'DOCUMENT_TOO_LARGE',
    message: 'The uploaded document exceeds the configured size limit',
  },
  LIMIT_FILE_COUNT: {
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_UPLOAD',
    message: 'Exactly one file may be uploaded per request',
  },
  LIMIT_UNEXPECTED_FILE: {
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_UPLOAD',
    message: 'The file must be sent in a multipart field named "file"',
  },
  LIMIT_FIELD_COUNT: {
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_UPLOAD',
    message: 'Too many form fields were sent',
  },
};

function multerFailure(exception: unknown): (typeof MULTER_ERRORS)[string] | null {
  if (typeof exception !== 'object' || exception === null) {
    return null;
  }

  const { name, code } = exception as { name?: unknown; code?: unknown };

  if (name !== 'MulterError' || typeof code !== 'string') {
    return null;
  }

  return (
    MULTER_ERRORS[code] ?? {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_UPLOAD',
      message: 'The upload could not be processed',
    }
  );
}

/**
 * One error shape for the whole API.
 *
 * The envelope is additive over Nest's default: `statusCode`, `message` and
 * `error` keep their meaning, so existing clients and the Phase 1 tests keep
 * working, while `code` and `details` give new clients something to branch on.
 *
 * 5xx responses are logged with their stack and returned with a generic
 * message. An unhandled exception's text can contain a query, a connection
 * string or a file path, and none of those belong in an HTTP response.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const upload = isHttp ? null : multerFailure(exception);
    const status = isHttp
      ? exception.getStatus()
      : (upload?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    // Nest translates multer's `LIMIT_FILE_SIZE` into a generic
    // `PayloadTooLargeException`, so the code has to be recovered from the
    // request shape: a multipart body over the limit is an oversized document,
    // and it must produce the same code as the service's own size check.
    const oversizedUpload =
      isHttp && status === HttpStatus.PAYLOAD_TOO_LARGE && request.is('multipart/form-data');

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const envelope: ErrorEnvelope = {
      statusCode: status,
      code:
        upload?.code ?? (oversizedUpload ? 'DOCUMENT_TOO_LARGE' : STATUS_CODES[status]) ?? 'ERROR',
      message:
        upload !== null
          ? upload.message
          : oversizedUpload
            ? 'The uploaded document exceeds the configured size limit'
            : status >= HttpStatus.INTERNAL_SERVER_ERROR
              ? 'Internal server error'
              : this.extractMessage(exception),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    if (isHttp) {
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;

        if (typeof record.code === 'string') {
          envelope.code = record.code;
        }

        if (record.details !== undefined && typeof record.details === 'object') {
          envelope.details = record.details as Record<string, unknown>;
        }
      }
    }

    response.status(status).json(envelope);
  }

  private extractMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body as { message?: unknown };

      if (typeof message === 'string' || Array.isArray(message)) {
        return message as string | string[];
      }
    }

    return exception.message;
  }
}
