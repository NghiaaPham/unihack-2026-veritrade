import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { BlockchainOperationStatus } from '../generated/prisma/client.js';

/**
 * Maps an operation's state to the HTTP status of the call that produced it.
 *
 * 202 is not a placeholder: the transaction is genuinely in flight and the
 * client should poll for the outcome. 409 carries the operation body so the
 * caller can read the decoded failure instead of guessing what went wrong.
 *
 * Shared by the invoice and financing controllers so both workflows answer the
 * same way for the same chain state.
 */
export function applyOperationStatus(response: Response, status: BlockchainOperationStatus): void {
  if (status === BlockchainOperationStatus.CONFIRMED) {
    response.status(HttpStatus.OK);
    return;
  }

  if (status === BlockchainOperationStatus.FAILED) {
    response.status(HttpStatus.CONFLICT);
    return;
  }

  response.status(HttpStatus.ACCEPTED);
}
