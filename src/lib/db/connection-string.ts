/**
 * Parameters that belong to a client library or a connection pooler, not to
 * PostgreSQL itself.
 *
 * postgres.js forwards any query parameter it does not recognise to the server
 * as a startup parameter, so leaving these in makes the server reject the
 * connection outright:
 *
 *   channel_binding=require  ->  42704 unrecognized configuration parameter
 *
 * Neon puts `channel_binding=require` in the connection string it shows in its
 * dashboard, so a copied-and-pasted URL fails on the very first query. It is a
 * libpq client-side setting asking for SCRAM channel binding, which postgres.js
 * does not implement — there is nothing to honour, only something to drop. TLS
 * is unaffected: `sslmode` is handled separately and still applies.
 */
const CLIENT_ONLY_PARAMS = [
  'channel_binding',
  // Prisma / pooler flavoured strings carry these; same problem.
  'pgbouncer',
  'connection_limit',
  'pool_timeout',
]

/**
 * Removes parameters the driver cannot honour and the server will not accept.
 * Everything before the query string is left byte-for-byte alone, so encoded
 * credentials are never rewritten.
 */
export function normaliseConnectionString(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url

  const base = url.slice(0, queryStart)
  const params = new URLSearchParams(url.slice(queryStart + 1))

  let removed = false
  for (const name of CLIENT_ONLY_PARAMS) {
    if (params.has(name)) {
      params.delete(name)
      removed = true
    }
  }
  if (!removed) return url

  const rest = params.toString()
  return rest ? `${base}?${rest}` : base
}

/** Names dropped from `url`, for diagnostics. */
export function droppedParams(url: string): string[] {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return []
  const params = new URLSearchParams(url.slice(queryStart + 1))
  return CLIENT_ONLY_PARAMS.filter((name) => params.has(name))
}
