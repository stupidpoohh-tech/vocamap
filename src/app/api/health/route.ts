import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { inspectConnectionString } from '@/lib/db/connection-string'
import { hyperdriveConnectionString } from '@/lib/db'
import { databaseErrorCode } from '@/lib/db/errors'

export const dynamic = 'force-dynamic'

/**
 * Operator diagnostic, reachable from a browser.
 *
 * Deliberately says nothing that would help an attacker: no host, no
 * credentials, no raw driver output — only whether the database answered, the
 * SQLSTATE code if it did not, and a hint for the causes we have actually hit.
 */
const HINTS: Record<string, string> = {
  '42704':
    'DATABASE_URL에 channel_binding 같은 클라이언트 전용 파라미터가 남아 있습니다. 앱이 자동으로 제거하도록 되어 있으니, 이 오류가 보이면 최신 버전이 배포되지 않은 상태입니다.',
  ECONNREFUSED: '데이터베이스가 연결을 거부했습니다. 호스트와 포트를 확인해 주세요.',
  ECONNRESET: 'TLS 연결이 끊겼습니다. sslmode=require 가 포함된 주소인지 확인해 주세요.',
  CONNECT_TIMEOUT:
    '연결이 시간 초과되었습니다. 아래 connectionString.problems 를 먼저 확인하세요. 문제가 없다면 Workers 에서 이 호스트로 TCP 접속이 되지 않는 것이므로 Hyperdrive 를 붙여야 합니다.',
  '28P01': '사용자 이름 또는 비밀번호가 올바르지 않습니다.',
  '3D000': '해당 이름의 데이터베이스가 없습니다.',
  '42P01': '테이블이 없습니다. db/setup.sql 을 아직 실행하지 않았을 수 있습니다.',
}

export async function GET() {
  const viaHyperdrive = Boolean(hyperdriveConnectionString())
  const version = process.env.APP_COMMIT ? process.env.APP_COMMIT.slice(0, 7) : 'local'
  const url = inspectConnectionString(process.env.DATABASE_URL)
  const startedAt = Date.now()

  if (url.scheme === 'missing') {
    return Response.json(
      { ok: false, database: 'not_configured', hint: 'DATABASE_URL 시크릿이 설정되지 않았습니다.' },
      { status: 503 },
    )
  }

  try {
    const [row] = await db.execute<{ words: number }>(
      sql`select count(*)::int as words from vocabularies`,
    )
    return Response.json({
      ok: true,
      version,
      database: 'ok',
      via: viaHyperdrive ? 'hyperdrive' : 'direct',
      elapsedMs: Date.now() - startedAt,
      seededWords: row?.words ?? 0,
      connectionString: url,
    })
  } catch (error) {
    console.error('[health]', error)
    const code = databaseErrorCode(error) ?? 'unknown'
    return Response.json(
      {
        ok: false,
        version,
        database: 'error',
        via: viaHyperdrive ? 'hyperdrive' : 'direct',
        elapsedMs: Date.now() - startedAt,
        code,
        hint: HINTS[code] ?? '알 수 없는 오류입니다. Cloudflare 대시보드의 Logs 를 확인해 주세요.',
        connectionString: url,
      },
      { status: 503 },
    )
  }
}
