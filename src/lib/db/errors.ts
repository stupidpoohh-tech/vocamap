/**
 * Drizzle wraps driver failures in its own error, so the PostgreSQL SQLSTATE —
 * the one piece of information that actually identifies the problem — sits on
 * `cause`, sometimes more than one level down. Reading `error.code` directly
 * reports "unknown" for every database fault, which is how a misconfigured
 * connection string looked like a generic 500.
 */
export function databaseErrorCode(error: unknown, depth = 5): string | undefined {
  let current: unknown = error
  for (let i = 0; i <= depth && current; i += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && code.length > 0) return code
    }
    current =
      typeof current === 'object' && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined
  }
  return undefined
}

/** Codes that mean "the database was not reachable or not usable at all". */
const CONNECTION_CODES = new Set([
  '42704', // unrecognized configuration parameter — a bad connection string
  '28P01', // invalid password
  '3D000', // database does not exist
  '42P01', // relation does not exist — schema never applied
  'ECONNREFUSED',
  'ECONNRESET',
  'CONNECT_TIMEOUT',
  'ENOTFOUND',
])

export function isConnectionFailure(error: unknown): boolean {
  const code = databaseErrorCode(error)
  return code !== undefined && CONNECTION_CODES.has(code)
}
