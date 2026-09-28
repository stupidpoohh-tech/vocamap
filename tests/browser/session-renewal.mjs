/**
 * Does a session survive being used, and does a lost one say why?
 *
 * Usage: node tests/browser/session-renewal.mjs <baseUrl> <dbUrl>
 *
 * The bug this covers had no visible symptom to test for: the cookie, the token
 * inside it and the `sessions` row were all stamped thirty days from sign-in
 * and never touched again, so the app worked perfectly until the day it signed
 * everybody out. So the checks are about the deadline moving, not about a
 * screen looking right.
 */
import { chromium, devices } from 'playwright'
import postgres from 'postgres'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3212'
const dbUrl = process.argv[3] ?? process.env.DATABASE_URL
if (!/test/i.test((dbUrl ?? '').split('/').pop() ?? '')) {
  throw new Error('Refusing to run against a database that is not named as a test database.')
}
const sql = postgres(dbUrl)
let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
async function phone() {
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  // Chromium's own background fetches are blocked in this sandbox and would
  // stall `networkidle` forever.
  await context.route('**', (r) =>
    r.request().url().startsWith(baseUrl) ? r.continue() : r.abort(),
  )
  return { context, page: await context.newPage() }
}
const cookieOf = async (context) =>
  (await context.cookies()).find((c) => c.name === 'vocamap_session')

async function signIn(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('form button')
  await page
    .waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 })
    .catch(() => {})
}

try {
  console.log('\n게스트가 읽는 화면')
  {
    const { context, page } = await phone()
    for (const path of ['/study', '/map', '/login/help']) {
      const response = await page.goto(baseUrl + path, { waitUntil: 'domcontentloaded' })
      check(`${path} 는 로그인 없이 열린다`, page.url().includes(path), `${page.url()} ${response?.status()}`)
    }
    await context.close()
  }

  console.log('\n로그인한 채로 계속 쓰기')
  const { context, page } = await phone()
  {
    await signIn(page, 't@test.local', 'test-password')
    check('로그인된다', !page.url().includes('/login'), page.url())

    for (const path of ['/study', '/vault', '/study', '/vault', '/study']) {
      await page.goto(baseUrl + path, { waitUntil: 'domcontentloaded' })
      if (page.url().includes('/login')) {
        check(`${path} 이동 중 로그인이 풀리지 않는다`, false, page.url())
        break
      }
    }
    check('여러 화면을 오가도 로그인이 유지된다', !page.url().includes('/login'), page.url())
  }

  console.log('\n만료가 다가온 세션')
  {
    const before = await cookieOf(context)
    // Wind the whole session back to two days left, cookie included.
    await sql`update sessions set expires_at = now() + interval '2 days'`
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? '')
    const [row] = await sql`select id, user_id from sessions limit 1`
    const soon = new Date(Date.now() + 2 * 86_400_000)
    const short = await new SignJWT({ sid: row.id, uid: row.user_id, role: 'teacher' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(soon)
      .sign(secret)
    await context.addCookies([
      { ...before, value: short, expires: Math.floor(soon.getTime() / 1000) },
    ])

    // A plain re-visit is served from Next's client router cache and never
    // reaches the server, so the renewal would not run and the test would be
    // measuring the browser rather than the app.
    await page.goto(`${baseUrl}/study?t=${Date.now()}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const after = await cookieOf(context)
    const leftDays = (after.expires - Date.now() / 1000) / 86400
    check('쓰는 것만으로 쿠키 만료가 미뤄진다', leftDays > 28, `${leftDays.toFixed(1)}일 남음`)

    const [dbRow] = await sql`select expires_at from sessions limit 1`
    const dbLeft = (dbRow.expires_at.getTime() - Date.now()) / 86_400_000
    check('DB 행의 만료도 함께 미뤄진다', dbLeft > 28, `${dbLeft.toFixed(1)}일 남음`)
    check('로그인은 그대로 유지된다', !page.url().includes('/login'), page.url())
  }

  console.log('\n권한이 바뀐 뒤 (관리자 부여)')
  {
    // 이것이 admin 부여가 하는 일이다 — DB 의 역할만 바뀌고 브라우저의 쿠키는
    // 예전 역할을 그대로 들고 있다. 이 불일치가 화면을 로그인으로 보내고,
    // 로그인은 이미 로그인된 사람을 되돌려보내서 끝없이 돌았다. 주소가 하나도
    // 바뀌지 않아 밖에서는 빈 화면이 깜빡이는 것으로만 보였다.
    await sql`update users set role = 'admin' where email = 't@test.local'`

    let moves = 0
    const count = (f) => { if (f === page.mainFrame()) moves += 1 }
    page.on('framenavigated', count)
    await page.goto(`${baseUrl}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(6000)
    page.off('framenavigated', count)

    check('화면이 끝없이 다시 열리지 않는다', moves < 8, `6초에 ${moves}번 이동`)
    check('로그인 화면으로 쫓겨나지 않는다', !page.url().includes('/login'), page.url())

    const cookie = await cookieOf(context)
    const { jwtVerify } = await import('jose')
    const { payload } = await jwtVerify(
      cookie.value,
      new TextEncoder().encode(process.env.AUTH_SECRET ?? ''),
    )
    check('쿠키가 새 권한으로 다시 쓰인다', payload.role === 'admin', String(payload.role))
    check('보던 화면이 그대로 그려진다', (await page.textContent('body')).includes('단어'))

    const rows = await sql`select count(*)::int as n from sessions`
    check('세션을 새로 만들지 않는다 (같은 행을 고친다)', rows[0].n === 1, `${rows[0].n}개`)
  }

  console.log('\n정말로 끝난 세션')
  {
    await sql`delete from sessions`
    await page.goto(`${baseUrl}/vault?t=${Date.now()}`, { waitUntil: 'domcontentloaded' })
    // The cookie is still a token we signed, so the edge lets it through and
    // the bounce comes from the page itself, after the shell has streamed —
    // a client-side navigation, not a 307. It needs a moment.
    await page.waitForURL('**/login**', { timeout: 15000 }).catch(() => {})
    check('로그인 화면으로 보내진다', page.url().includes('/login'), page.url())
    check('돌아갈 곳을 기억한다', page.url().includes('next=%2Fvault'), page.url())
    const body = await page.textContent('body')
    check('왜 다시 로그인해야 하는지 설명한다', body.includes('다시 로그인이 필요합니다'))
  }
  await context.close()
} finally {
  await browser.close()
  await sql.end()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
