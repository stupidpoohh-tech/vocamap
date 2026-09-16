/**
 * The whole reset path, end to end, in a phone-sized browser.
 *
 * Usage: node tests/browser/password-reset.mjs <baseUrl> <dbUrl>
 *
 * It signs in as an admin, issues a temporary password for a student, reads
 * that password off the screen — it exists nowhere else — and then signs in as
 * the student with it and changes it. Every claim the feature makes is checked
 * against the database afterwards rather than against the screen.
 */
import { chromium, devices } from 'playwright'
import postgres from 'postgres'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3210'
const dbUrl = process.argv[3] ?? process.env.DATABASE_URL
if (!dbUrl) throw new Error('Pass a database URL or set DATABASE_URL.')
if (!/test/i.test(dbUrl.split('/').pop())) {
  throw new Error('Refusing to run against a database that is not named as a test database.')
}

const sql = postgres(dbUrl)
let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// The pinned @playwright/test version in this sandbox looks for a build that
// is not there; the preinstalled Chromium is.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

async function phone() {
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  return { context, page: await context.newPage() }
}

/**
 * `waitForLoadState` resolves against the state the page is already in, so
 * racing it with the click returns before the action has even run. The sign-in
 * is a server action followed by a redirect; the only honest wait is for the
 * URL to stop being the login screen, or for the error to appear.
 */
/**
 * The app shell has a sign-out form of its own, so `form button` is ambiguous
 * on every screen inside it. The change form's button is named.
 */
const submit = (page) => page.getByRole('button', { name: '비밀번호 바꾸기' }).click()

async function signIn(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('form button')
  await page
    .waitForFunction(
      () => !location.pathname.startsWith('/login') || Boolean(document.querySelector('[role=alert]')),
      { timeout: 15000 },
    )
    .catch(() => {})
  await page.waitForLoadState('networkidle')
}

try {
  /* ── 1. the link, and the page it goes to ── */
  console.log('\n로그인 화면의 비밀번호 찾기')
  {
    const { context, page } = await phone()
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
    const link = page.getByRole('link', { name: '비밀번호를 잊으셨나요?' })
    check('로그인 탭에 비밀번호 찾기 링크가 있다', await link.isVisible())

    await page.getByRole('button', { name: '회원가입' }).click()
    check('회원가입 탭에서는 보이지 않는다', !(await link.isVisible()))

    await page.getByRole('button', { name: '로그인', exact: true }).first().click()
    await link.click()
    await page.waitForURL('**/login/help', { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle')
    check('안내 화면으로 이동한다', page.url().endsWith('/login/help'), page.url())
    check(
      '메일이 아니라 선생님에게 요청하라고 안내한다',
      (await page.textContent('body')).includes('선생님이 임시 비밀번호'),
    )
    // The phone is 390 wide; a page that scrolls sideways on it is broken.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    check('390px 화면에서 가로 스크롤이 생기지 않는다', !overflow)
    await context.close()
  }

  /* ── 2. an admin issues one ── */
  console.log('\n관리자의 임시 비밀번호 발급')
  let issued = null
  {
    const { context, page } = await phone()
    await signIn(page, 'admin@test.local', 'admin-password')
    await page.goto(`${baseUrl}/admin/teachers`, { waitUntil: 'networkidle' })

    const row = page.locator('li', { hasText: 'jiwoo@test.local' }).last()
    check('학생이 발급 목록에 있다', await row.isVisible())
    const adminRow = page.locator('li', { hasText: 'admin@test.local' })
    check('관리자 계정은 목록에 없다', (await adminRow.count()) === 0)

    await row.getByRole('button', { name: '임시 비밀번호' }).click()
    await page.waitForTimeout(2500)
    issued = (await row.locator('.font-mono').textContent())?.trim() ?? null
    check('발급된 비밀번호가 화면에 나타난다', Boolean(issued), String(issued))
    check('읽기 쉬운 글자만 쓴다', /^[a-z2-9-]+$/.test(issued ?? ''), String(issued))

    const [student] = await sql`select * from users where email = 'jiwoo@test.local'`
    check('계정에 변경 필요 표시가 남는다', student.must_change_password_at !== null)
    check('누가 발급했는지 기록된다', student.password_reset_by !== null)
    await context.close()
  }

  /* ── 3. the old password is gone ── */
  console.log('\n원래 비밀번호')
  {
    const { context, page } = await phone()
    await signIn(page, 'jiwoo@test.local', 'old-password')
    check('예전 비밀번호로는 로그인되지 않는다', page.url().includes('/login'), page.url())
    check(
      '같은 실패 메시지를 보여 준다',
      (await page.textContent('body')).includes('이메일 또는 비밀번호가 올바르지 않습니다'),
    )
    await context.close()
  }

  /* ── 4. the student signs in with it and is sent to the change screen ── */
  console.log('\n임시 비밀번호로 로그인')
  const { context: studentContext, page: student } = await phone()
  {
    await signIn(student, 'jiwoo@test.local', issued)
    check('비밀번호 변경 화면으로 바로 보내진다', student.url().includes('/account/password'), student.url())
    const body = await student.textContent('body')
    check('임시 비밀번호라는 사실을 설명한다', body.includes('임시 비밀번호'))

    // Leaving is allowed, but the way back is on every screen.
    await student.goto(`${baseUrl}/study`, { waitUntil: 'networkidle' })
    const header = student.getByRole('link', { name: '비밀번호 변경' })
    check('화면을 벗어나도 헤더에 변경 링크가 남는다', await header.isVisible())
  }

  /* ── 5. the change itself ── */
  console.log('\n비밀번호 변경')
  {
    await student.goto(`${baseUrl}/account/password`, { waitUntil: 'networkidle' })

    // Wrong current password.
    await student.fill('input[name="current"]', 'not-the-temporary-one')
    await student.fill('input[name="next"]', 'my-own-password')
    await student.fill('input[name="confirm"]', 'my-own-password')
    await submit(student)
    await student.waitForTimeout(2500)
    check(
      '현재 비밀번호가 틀리면 거절한다',
      (await student.textContent('body')).includes('현재 비밀번호가 올바르지 않습니다'),
    )

    // Mismatched confirmation.
    await student.fill('input[name="current"]', issued)
    await student.fill('input[name="next"]', 'my-own-password')
    await student.fill('input[name="confirm"]', 'my-own-passwood')
    await submit(student)
    await student.waitForTimeout(2000)
    check(
      '새 비밀번호 확인이 다르면 거절한다',
      (await student.textContent('body')).includes('새 비밀번호가 서로 다릅니다'),
    )

    // The real change.
    await student.fill('input[name="current"]', issued)
    await student.fill('input[name="next"]', 'my-own-password')
    await student.fill('input[name="confirm"]', 'my-own-password')
    await submit(student)
    await student.waitForURL((url) => !url.pathname.startsWith('/account'), { timeout: 15000 })
    await student.waitForLoadState('networkidle')
    check('변경 후 학습 화면으로 돌아온다', student.url().includes('/study'), student.url())

    const [row] = await sql`select * from users where email = 'jiwoo@test.local'`
    check('변경 필요 표시가 지워진다', row.must_change_password_at === null)
    check('발급자 기록도 함께 지워진다', row.password_reset_by === null)

    const header = student.getByRole('link', { name: '비밀번호 변경' })
    await student.reload({ waitUntil: 'networkidle' })
    check('헤더의 변경 링크가 사라진다', !(await header.isVisible()))
    check(
      '이름이 다시 보인다',
      (await student.textContent('header')).includes('지우'),
    )
  }

  /* ── 6. the session that was on the temporary password ── */
  console.log('\n임시 비밀번호로 열려 있던 세션')
  {
    const sessions = await sql`
      select count(*)::int as n from sessions s
      join users u on u.id = s.user_id where u.email = 'jiwoo@test.local'`
    check('변경 뒤 살아 있는 세션은 새로 만든 하나뿐이다', sessions[0].n === 1, `n=${sessions[0].n}`)

    const { context, page } = await phone()
    await signIn(page, 'jiwoo@test.local', issued)
    check('임시 비밀번호는 더 이상 통하지 않는다', page.url().includes('/login'), page.url())
    await context.close()

    const { context: c2, page: p2 } = await phone()
    await signIn(p2, 'jiwoo@test.local', 'my-own-password')
    check('본인이 정한 비밀번호로는 바로 들어간다', p2.url().includes('/study'), p2.url())
    check(
      '변경 화면으로 다시 보내지 않는다',
      !p2.url().includes('/account/password'),
      p2.url(),
    )
    await c2.close()
  }

  await studentContext.close()

  /* ── 7. who may issue ── */
  console.log('\n발급 권한')
  {
    const { context, page } = await phone()
    await signIn(page, 'jiwoo@test.local', 'my-own-password')
    const response = await page.goto(`${baseUrl}/admin/teachers`, { waitUntil: 'networkidle' })
    check(
      '학생은 발급 화면을 열 수 없다',
      !page.url().includes('/admin/teachers'),
      `${page.url()} (${response?.status()})`,
    )
    await context.close()
  }
} finally {
  await browser.close()
  await sql.end()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
