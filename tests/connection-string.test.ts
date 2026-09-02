import { describe, expect, it } from 'vitest'
import { droppedParams, normaliseConnectionString } from '@/lib/db/connection-string'

const NEON = 'postgresql://user:p%40ssw0rd@ep-cool-lab-123-pooler.ap-southeast-1.aws.neon.tech/vocamap'

describe('connection string normalisation', () => {
  it('drops channel_binding, which Neon adds and postgres.js cannot honour', () => {
    // Left in, the server rejects the connection with 42704 and every request
    // that touches the database returns a 500.
    expect(normaliseConnectionString(`${NEON}?sslmode=require&channel_binding=require`)).toBe(
      `${NEON}?sslmode=require`,
    )
  })

  it('keeps sslmode, so TLS is still required', () => {
    const result = normaliseConnectionString(`${NEON}?sslmode=require&channel_binding=require`)
    expect(result).toContain('sslmode=require')
  })

  it('handles channel_binding appearing first, last or alone', () => {
    expect(normaliseConnectionString(`${NEON}?channel_binding=require&sslmode=require`)).toBe(
      `${NEON}?sslmode=require`,
    )
    expect(normaliseConnectionString(`${NEON}?channel_binding=require`)).toBe(NEON)
    expect(normaliseConnectionString(`${NEON}?a=1&channel_binding=require&b=2`)).toBe(
      `${NEON}?a=1&b=2`,
    )
  })

  it('drops pooler-flavoured parameters too', () => {
    expect(normaliseConnectionString(`${NEON}?pgbouncer=true&connection_limit=1`)).toBe(NEON)
  })

  it('leaves a clean URL untouched', () => {
    expect(normaliseConnectionString(`${NEON}?sslmode=require`)).toBe(`${NEON}?sslmode=require`)
    expect(normaliseConnectionString(NEON)).toBe(NEON)
    expect(normaliseConnectionString('postgresql://postgres@localhost:5432/vocamap')).toBe(
      'postgresql://postgres@localhost:5432/vocamap',
    )
  })

  it('never rewrites the credentials portion', () => {
    // An encoded password must survive byte-for-byte, or authentication fails.
    const result = normaliseConnectionString(`${NEON}?channel_binding=require`)
    expect(result).toContain('user:p%40ssw0rd@')
  })

  it('reports what it dropped, for diagnostics', () => {
    expect(droppedParams(`${NEON}?sslmode=require&channel_binding=require`)).toEqual([
      'channel_binding',
    ])
    expect(droppedParams(`${NEON}?sslmode=require`)).toEqual([])
  })
})

describe('database error codes', () => {
  it('finds the SQLSTATE that Drizzle buried under `cause`', async () => {
    const { databaseErrorCode, isConnectionFailure } = await import('@/lib/db/errors')

    const driverError = Object.assign(new Error('database "x" does not exist'), { code: '3D000' })
    const wrapped = new Error('Failed query', { cause: driverError })

    expect(databaseErrorCode(wrapped)).toBe('3D000')
    expect(isConnectionFailure(wrapped)).toBe(true)
  })

  it('walks more than one level of wrapping', async () => {
    const { databaseErrorCode } = await import('@/lib/db/errors')
    const inner = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    expect(databaseErrorCode(new Error('a', { cause: new Error('b', { cause: inner }) }))).toBe(
      'ECONNREFUSED',
    )
  })

  it('returns undefined rather than guessing when there is no code', async () => {
    const { databaseErrorCode, isConnectionFailure } = await import('@/lib/db/errors')
    expect(databaseErrorCode(new Error('plain'))).toBeUndefined()
    expect(isConnectionFailure(new Error('plain'))).toBe(false)
  })
})
