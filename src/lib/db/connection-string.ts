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
 * Removes parameters the driver cannot honour and the server will not accept,
 * and trims stray quotes or whitespace picked up when pasting the value into a
 * dashboard field.
 *
 * Everything else before the query string is left byte-for-byte alone, so
 * encoded credentials are never rewritten.
 */
export function normaliseConnectionString(url: string): string {
  const trimmed = stripWrapping(url)
  const queryStart = trimmed.indexOf('?')
  if (queryStart === -1) return trimmed

  const base = trimmed.slice(0, queryStart)
  const params = new URLSearchParams(trimmed.slice(queryStart + 1))

  for (const name of CLIENT_ONLY_PARAMS) params.delete(name)

  // postgres.js turns on TLS for any truthy `ssl` value, and it derives `ssl`
  // straight from `sslmode` — so the string "disable" switches TLS *on*.
  // Dropping the parameter falls back to the correct default of no TLS.
  // (Hyperdrive's local connection string sets exactly this.)
  if (params.get('sslmode') === 'disable') params.delete('sslmode')

  const rest = params.toString()
  return rest ? `${base}?${rest}` : base
}

/**
 * A value pasted into a dashboard field often arrives wrapped: surrounding
 * quotes copied from an example, a trailing newline, or a `psql ...` prefix
 * copied from a "connect" snippet. Any of those make the host unparseable and
 * the connection time out against a hostname that does not exist.
 */
function stripWrapping(url: string): string {
  let value = url.trim()
  const psql = /^psql\s+/i
  if (psql.test(value)) value = value.replace(psql, '').trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) value = value.slice(1, -1).trim()
  }
  return value
}

/** Names dropped from `url`, for diagnostics. */
export function droppedParams(url: string): string[] {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return []
  const params = new URLSearchParams(url.slice(queryStart + 1))
  return CLIENT_ONLY_PARAMS.filter((name) => params.has(name))
}

/* ─────────────────────────── diagnostics ─────────────────────────── */

export type ConnectionStringReport = {
  /** Whether the value looks like a Postgres URL at all. */
  scheme: 'ok' | 'wrong' | 'missing'
  hasCredentials: boolean
  /** Last three labels of the host, e.g. "aws.neon.tech". Never the full host. */
  hostSuffix: string | null
  port: number | null
  /** Neon's pooled endpoint has "-pooler" in the hostname. */
  pooled: boolean
  sslmode: string | null
  strippedParams: string[]
  /** Human-readable problems, safe to show. Empty means the shape looks right. */
  problems: string[]
}

/**
 * Describes the *shape* of DATABASE_URL without revealing it.
 *
 * Answers "did I paste the right thing into the right box?" — the question a
 * connection timeout cannot answer on its own — while exposing no credentials,
 * no full hostname and no database name.
 */
export function inspectConnectionString(raw: string | undefined): ConnectionStringReport {
  const problems: string[] = []

  if (!raw) {
    return {
      scheme: 'missing',
      hasCredentials: false,
      hostSuffix: null,
      port: null,
      pooled: false,
      sslmode: null,
      strippedParams: [],
      problems: ['DATABASE_URL 값이 비어 있습니다.'],
    }
  }

  if (raw !== raw.trim()) problems.push('값의 앞뒤에 공백이나 줄바꿈이 있습니다.')
  if (/^["']|["']$/.test(raw.trim())) problems.push('값이 따옴표로 감싸여 있습니다. 따옴표 없이 넣어야 합니다.')
  if (/^psql\s/i.test(raw.trim())) problems.push('psql 명령 전체가 들어가 있습니다. URL 부분만 넣어야 합니다.')
  if (/\s/.test(stripWrapping(raw))) problems.push('값 중간에 공백이 있습니다.')

  const cleaned = normaliseConnectionString(raw)

  let parsed: URL | null = null
  try {
    parsed = new URL(cleaned)
  } catch {
    parsed = null
  }

  const scheme =
    parsed && (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:')
      ? ('ok' as const)
      : ('wrong' as const)
  if (scheme === 'wrong') {
    problems.push('postgresql:// 로 시작하는 주소가 아닙니다.')
  }

  const host = parsed?.hostname ?? ''
  const labels = host.split('.')
  const hostSuffix = labels.length >= 3 ? labels.slice(-3).join('.') : host || null

  if (parsed && !host) problems.push('주소에 호스트가 없습니다.')
  if (parsed && host && !host.includes('.')) {
    problems.push('호스트가 도메인 형태가 아닙니다.')
  }
  if (parsed && !parsed.username) problems.push('주소에 사용자 이름이 없습니다.')

  const sslmode = parsed?.searchParams.get('sslmode') ?? null
  if (scheme === 'ok' && host.endsWith('neon.tech') && sslmode !== 'require') {
    problems.push('Neon 주소인데 sslmode=require 가 없습니다.')
  }

  const pooled = host.includes('-pooler')
  if (scheme === 'ok' && host.endsWith('neon.tech') && !pooled) {
    problems.push('Pooled 주소가 아닙니다 (호스트에 -pooler 가 없음). Neon의 Pooled connection 을 쓰세요.')
  }

  return {
    scheme,
    hasCredentials: Boolean(parsed?.username),
    hostSuffix,
    port: parsed?.port ? Number(parsed.port) : null,
    pooled,
    sslmode,
    strippedParams: droppedParams(raw),
    problems,
  }
}
