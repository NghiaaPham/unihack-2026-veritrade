/**
 * Environment validation for the API.
 *
 * Deliberately hand-written rather than pulled from `joi` or `zod`: the whole
 * surface is six variables, and a dependency here would have to be kept in
 * step with Nest's config module for no benefit.
 *
 * `ConfigModule.forRoot({ validate })` calls this with the merged result of
 * `process.env` and the `.env` files. Throwing aborts bootstrap, which is the
 * point: a malformed `DATABASE_URL` should stop the process, not turn into a
 * 500 on the first request that touches the database.
 */

const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

const DEFAULT_NODE_ENV = 'development';
const DEFAULT_API_PORT = 3001;
const DEFAULT_AVALANCHE_CHAIN_ID = 43113;
const DEFAULT_JWT_EXPIRES_IN_SECONDS = 3600;
const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_BLOCKCHAIN_CONFIRMATIONS = 1;
const DEFAULT_INDEXER_INTERVAL_MS = 0;

/**
 * Reconciliation defaults.
 *
 * The worker is on by default — an operation that nobody sweeps is exactly the
 * gap this phase closes — but 30s keeps a quiet deployment from doing anything
 * at all, because the query returns no rows.
 */
const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;

/**
 * Write quota defaults.
 *
 * 60 writes a minute is far above anything a demo or a single tenant does and
 * far below what it takes to drain a testnet faucet. The pending cap is the
 * more important number: it bounds *concurrent* spend regardless of how slowly
 * an attacker paces their requests.
 */
const DEFAULT_BLOCKCHAIN_WRITE_LIMIT = 60;
const DEFAULT_WRITE_WINDOW_SECONDS = 60;
const DEFAULT_MAX_PENDING_OPERATIONS = 25;

/**
 * Chains this API may talk to. Fuji is the target; the local Hardhat chain is
 * allowed so the whole pipeline can be exercised without a testnet key.
 */
const SUPPORTED_CHAIN_IDS = [43113, 31337] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface Environment {
  NODE_ENV: NodeEnvironment;
  API_PORT: number;
  DATABASE_URL: string;
  CORS_ORIGIN: string;
  AVALANCHE_CHAIN_ID: number;
  AVALANCHE_RPC_URL: string | undefined;
  VERITRADE_CONTRACT_ADDRESS: string | undefined;
  AVALANCHE_DEPLOYER_PRIVATE_KEY: string | undefined;
  BLOCKCHAIN_CONFIRMATIONS: number;
  BLOCKCHAIN_INDEXER_INTERVAL_MS: number;
  BLOCKCHAIN_RECONCILE_INTERVAL_MS: number;
  BLOCKCHAIN_WRITE_LIMIT: number;
  BLOCKCHAIN_WRITE_WINDOW_SECONDS: number;
  BLOCKCHAIN_MAX_PENDING_OPERATIONS: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN_SECONDS: number;
  AUTH_ALLOW_REGISTRATION: boolean;
  INVOICE_STORAGE_DIR: string;
  INVOICE_MAX_UPLOAD_BYTES: number;
}

function requireString(raw: Record<string, unknown>, key: string, errors: string[]): string {
  const value = raw[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${key} is required`);
    return '';
  }

  return value.trim();
}

function parsePort(value: string, key: string, errors: string[]): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    errors.push(`${key} must be an integer between 1 and 65535 (received "${value}")`);
    return DEFAULT_API_PORT;
  }

  return parsed;
}

function parsePostgresUrl(value: string, key: string, errors: string[]): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    errors.push(`${key} is not a valid URL`);
    return value;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    errors.push(`${key} must use the postgres:// or postgresql:// scheme`);
  }

  return value;
}

function parseOrigins(value: string, key: string, errors: string[]): string {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    errors.push(`${key} must list at least one origin`);
    return value;
  }

  for (const origin of origins) {
    try {
      const parsed = new URL(origin);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`${key} entry "${origin}" must use http:// or https://`);
      }
    } catch {
      errors.push(`${key} entry "${origin}" is not a valid origin`);
    }
  }

  return origins.join(',');
}

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const errors: string[] = [];

  const nodeEnv = (raw.NODE_ENV ?? DEFAULT_NODE_ENV) as string;
  if (!NODE_ENVIRONMENTS.includes(nodeEnv as NodeEnvironment)) {
    errors.push(`NODE_ENV must be one of ${NODE_ENVIRONMENTS.join(', ')} (received "${nodeEnv}")`);
  }

  const apiPort = parsePort(String(raw.API_PORT ?? DEFAULT_API_PORT), 'API_PORT', errors);

  // Checked in two steps so a missing value produces one message, not a
  // "required" and a "not a valid URL" for the same empty string.
  const rawDatabaseUrl = requireString(raw, 'DATABASE_URL', errors);
  const databaseUrl =
    rawDatabaseUrl.length === 0 ? '' : parsePostgresUrl(rawDatabaseUrl, 'DATABASE_URL', errors);

  const corsOrigin = parseOrigins(
    typeof raw.CORS_ORIGIN === 'string' && raw.CORS_ORIGIN.trim().length > 0
      ? raw.CORS_ORIGIN
      : 'http://localhost:3000',
    'CORS_ORIGIN',
    errors,
  );

  const avalancheChainIdRaw = raw.AVALANCHE_CHAIN_ID;
  const avalancheChainIdProvided =
    avalancheChainIdRaw !== undefined && String(avalancheChainIdRaw).trim().length > 0;
  const avalancheChainId = Number(avalancheChainIdRaw ?? DEFAULT_AVALANCHE_CHAIN_ID);
  if (!Number.isInteger(avalancheChainId) || avalancheChainId < 1) {
    errors.push('AVALANCHE_CHAIN_ID must be a positive integer');
  } else if (
    !SUPPORTED_CHAIN_IDS.includes(avalancheChainId as (typeof SUPPORTED_CHAIN_IDS)[number])
  ) {
    // Mainnet (43114) is rejected here as well as in the deployment scripts:
    // one guard in the deploy tooling is not enough if the API can be pointed
    // at a chain the tooling never sees.
    errors.push(
      `AVALANCHE_CHAIN_ID must be one of ${SUPPORTED_CHAIN_IDS.join(', ')} (received ${avalancheChainId})`,
    );
  }

  // A present deployer key means the API can sign and broadcast transactions.
  // On such a "signing-capable" deployment the chain id must be set explicitly
  // rather than falling back to the 43113 default, so local development can
  // never silently target Fuji just because someone added a key without
  // thinking about the network. The key is validated for shape further down.
  const hasSigningKey =
    typeof raw.AVALANCHE_DEPLOYER_PRIVATE_KEY === 'string' &&
    raw.AVALANCHE_DEPLOYER_PRIVATE_KEY.trim().length > 0;

  if (hasSigningKey && !avalancheChainIdProvided) {
    errors.push(
      'AVALANCHE_CHAIN_ID must be set explicitly when AVALANCHE_DEPLOYER_PRIVATE_KEY is present (it must not fall back to the 43113 default on a signing-capable deployment)',
    );
  }

  const avalancheRpcUrl =
    typeof raw.AVALANCHE_RPC_URL === 'string' && raw.AVALANCHE_RPC_URL.trim().length > 0
      ? raw.AVALANCHE_RPC_URL.trim()
      : undefined;

  // Plain HTTP is only acceptable for the local development chain. A public
  // endpoint over http would leak which invoices are being queried and let
  // anyone tamper with the responses, so it stays rejected everywhere else.
  if (avalancheRpcUrl !== undefined) {
    const isHttps = avalancheRpcUrl.startsWith('https://');
    const isLocalHttp = avalancheChainId === 31337 && avalancheRpcUrl.startsWith('http://');

    if (!isHttps && !isLocalHttp) {
      errors.push('AVALANCHE_RPC_URL must use https:// (http:// is allowed only on chain 31337)');
    }
  }

  const contractAddress =
    typeof raw.VERITRADE_CONTRACT_ADDRESS === 'string' &&
    raw.VERITRADE_CONTRACT_ADDRESS.trim().length > 0
      ? raw.VERITRADE_CONTRACT_ADDRESS.trim()
      : undefined;

  if (contractAddress !== undefined && !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    errors.push('VERITRADE_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address');
  }

  // Optional: when absent the API still serves reads and refuses to sign. A
  // missing key must never be silently replaced by a node account.
  const deployerPrivateKeyRaw =
    typeof raw.AVALANCHE_DEPLOYER_PRIVATE_KEY === 'string' &&
    raw.AVALANCHE_DEPLOYER_PRIVATE_KEY.trim().length > 0
      ? raw.AVALANCHE_DEPLOYER_PRIVATE_KEY.trim()
      : undefined;

  if (deployerPrivateKeyRaw !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKeyRaw)) {
    errors.push('AVALANCHE_DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string');
  }

  const blockchainConfirmations = Number(
    raw.BLOCKCHAIN_CONFIRMATIONS ?? DEFAULT_BLOCKCHAIN_CONFIRMATIONS,
  );
  if (
    !Number.isInteger(blockchainConfirmations) ||
    blockchainConfirmations < 1 ||
    blockchainConfirmations > 64
  ) {
    errors.push('BLOCKCHAIN_CONFIRMATIONS must be an integer between 1 and 64');
  }

  const indexerIntervalMs = Number(
    raw.BLOCKCHAIN_INDEXER_INTERVAL_MS ?? DEFAULT_INDEXER_INTERVAL_MS,
  );
  if (
    !Number.isInteger(indexerIntervalMs) ||
    indexerIntervalMs < 0 ||
    indexerIntervalMs > 3_600_000
  ) {
    errors.push('BLOCKCHAIN_INDEXER_INTERVAL_MS must be an integer between 0 and 3600000');
  }

  const reconcileIntervalMs = Number(
    raw.BLOCKCHAIN_RECONCILE_INTERVAL_MS ?? DEFAULT_RECONCILE_INTERVAL_MS,
  );
  if (
    !Number.isInteger(reconcileIntervalMs) ||
    reconcileIntervalMs < 0 ||
    reconcileIntervalMs > 3_600_000
  ) {
    errors.push('BLOCKCHAIN_RECONCILE_INTERVAL_MS must be an integer between 0 and 3600000');
  }

  const writeLimit = Number(raw.BLOCKCHAIN_WRITE_LIMIT ?? DEFAULT_BLOCKCHAIN_WRITE_LIMIT);
  if (!Number.isInteger(writeLimit) || writeLimit < 1 || writeLimit > 100_000) {
    errors.push('BLOCKCHAIN_WRITE_LIMIT must be an integer between 1 and 100000');
  }

  const writeWindowSeconds = Number(
    raw.BLOCKCHAIN_WRITE_WINDOW_SECONDS ?? DEFAULT_WRITE_WINDOW_SECONDS,
  );
  if (
    !Number.isInteger(writeWindowSeconds) ||
    writeWindowSeconds < 1 ||
    writeWindowSeconds > 86_400
  ) {
    errors.push('BLOCKCHAIN_WRITE_WINDOW_SECONDS must be an integer between 1 and 86400');
  }

  const maxPendingOperations = Number(
    raw.BLOCKCHAIN_MAX_PENDING_OPERATIONS ?? DEFAULT_MAX_PENDING_OPERATIONS,
  );
  if (
    !Number.isInteger(maxPendingOperations) ||
    maxPendingOperations < 1 ||
    maxPendingOperations > 10_000
  ) {
    errors.push('BLOCKCHAIN_MAX_PENDING_OPERATIONS must be an integer between 1 and 10000');
  }

  const jwtSecret = requireString(raw, 'JWT_SECRET', errors);

  if (jwtSecret.length > 0 && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  const jwtExpiresInSeconds = Number(raw.JWT_EXPIRES_IN_SECONDS ?? DEFAULT_JWT_EXPIRES_IN_SECONDS);

  if (!Number.isInteger(jwtExpiresInSeconds) || jwtExpiresInSeconds < 60) {
    errors.push('JWT_EXPIRES_IN_SECONDS must be an integer of at least 60');
  }

  // Registration is open in development so the demo can be bootstrapped, and
  // closed in production unless someone opts in. An accidentally public
  // registration endpoint is an account-takeover surface, so the default has
  // to be the safe one.
  const allowRegistrationRaw = raw.AUTH_ALLOW_REGISTRATION;
  const authAllowRegistration =
    allowRegistrationRaw === undefined
      ? nodeEnv !== 'production'
      : String(allowRegistrationRaw).toLowerCase() === 'true';

  const invoiceStorageDir =
    typeof raw.INVOICE_STORAGE_DIR === 'string' && raw.INVOICE_STORAGE_DIR.trim().length > 0
      ? raw.INVOICE_STORAGE_DIR.trim()
      : 'var/invoices';

  const maxUploadBytes = Number(raw.INVOICE_MAX_UPLOAD_BYTES ?? 2_097_152);

  if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 1024 || maxUploadBytes > 20_971_520) {
    errors.push('INVOICE_MAX_UPLOAD_BYTES must be an integer between 1024 and 20971520');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    API_PORT: apiPort,
    DATABASE_URL: databaseUrl,
    CORS_ORIGIN: corsOrigin,
    AVALANCHE_CHAIN_ID: avalancheChainId,
    AVALANCHE_RPC_URL: avalancheRpcUrl,
    VERITRADE_CONTRACT_ADDRESS: contractAddress,
    AVALANCHE_DEPLOYER_PRIVATE_KEY: deployerPrivateKeyRaw,
    BLOCKCHAIN_CONFIRMATIONS: blockchainConfirmations,
    BLOCKCHAIN_INDEXER_INTERVAL_MS: indexerIntervalMs,
    BLOCKCHAIN_RECONCILE_INTERVAL_MS: reconcileIntervalMs,
    BLOCKCHAIN_WRITE_LIMIT: writeLimit,
    BLOCKCHAIN_WRITE_WINDOW_SECONDS: writeWindowSeconds,
    BLOCKCHAIN_MAX_PENDING_OPERATIONS: maxPendingOperations,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN_SECONDS: jwtExpiresInSeconds,
    AUTH_ALLOW_REGISTRATION: authAllowRegistration,
    INVOICE_STORAGE_DIR: invoiceStorageDir,
    INVOICE_MAX_UPLOAD_BYTES: maxUploadBytes,
  };
}
