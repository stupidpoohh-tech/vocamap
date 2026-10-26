/**
 * 네 화면을 실제 브라우저에서 한 번씩 돌려 본다.
 *
 * 단위 시험은 규칙을 지키지만 화면이 그려지는지는 말해 주지 않는다. 이
 * 구조에서는 그 차이가 크다 — 콘텐츠는 미리 구워 둔 HTML 이고 개인 기록은
 * 브라우저가 그려진 뒤에 얹는 것이라, 둘이 어긋나면(hydration) 단위 시험은
 * 전부 통과한 채로 화면만 비어 있을 수 있다.
 *
 * 쓰는 법:
 *   pnpm build && pnpm start -p 3103
 *   node tests/browser/screens.mjs http://127.0.0.1:3103
 *
 * 자동으로 돌지 않는다. 브라우저와 띄워 둔 서버가 필요해서다.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3103'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
// 바깥으로 나가는 요청은 이 샌드박스에서 막혀 있어, 기다리면 끝나지 않는다.
await page.route('**', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(`${name}${extra ? ` — ${extra}` : ''}`)

/* ── 단어 목록 ──────────────────────────────────────────────────────────── */

await page.goto(`${BASE}/study`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('ul > li')

// 줄을 센다. `/words/` 링크는 맵이 있는 단어에만 붙는 '맵' 칩이라 줄 수가 아니다.
const rowsOf = () => page.locator('ul > li').count()
const rows = await rowsOf()
check('목록에 단어가 보인다', rows === 235, `${rows}줄`)

await page.getByRole('button', { name: 'J2' }).click()
await page.waitForTimeout(150)
check('세트 탭이 거른다', (await rowsOf()) === 16, `전체 ${rows}줄`)

await page.getByRole('button', { name: '전체' }).click()
await page.waitForTimeout(100)
await page.locator('button[aria-label*="보관함에 담기"]').first().click()
await page.waitForTimeout(150)
await page.getByRole('button', { name: /담은 것/ }).click()
await page.waitForTimeout(150)
check('별을 누르면 담은 것에 들어간다', (await rowsOf()) === 1)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(300)
await page.getByRole('button', { name: /담은 것/ }).click()
await page.waitForTimeout(150)
check('새로 고쳐도 남는다', (await rowsOf()) === 1)

/* ── 단어 상세 + 맵 ─────────────────────────────────────────────────────── */

await page.goto(`${BASE}/words/affect`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('h1')
check('단어가 제목이다', (await page.locator('h1').first().innerText()) === 'affect')
check('맵이 그려진다', (await page.locator('svg').count()) > 0)

/**
 * 처음 열리는 카드는 '해석 확인' — 영영 풀이의 한국어 해석을 읽는 카드다.
 * 읽은 것은 답이 아니라서 아무것도 적지 않는다. 채점되는 노드로 옮긴다.
 */
check('처음 열리는 카드는 영영 풀이 해석이다',
  (await page.getByRole('button', { name: '해석 확인' }).count()) > 0)

await page.getByRole('button', { name: /함께 쓰는 표현/ }).first().click()
await page.waitForTimeout(300)
const options = page.locator('div[class*="grid-cols"] > button[type="button"]')
const optionCount = await options.count()
let answered = false
if (optionCount) {
  await options.first().click()
  await page.waitForTimeout(300)
  // 맵의 카드와 시험의 카드는 말이 다르다 — 맵은 '정답입니다 / 다시 볼게요'.
  answered = (await page.getByText(/정답입니다|다시 볼게요/).count()) > 0
}
check('맵의 문제를 풀면 채점된다', answered, `보기 ${optionCount}개`)

const stored = JSON.parse(
  (await page.evaluate(() => localStorage.getItem('vocamap.learning.v1'))) ?? '{}',
)
const items = Object.keys(stored.items ?? {})
check('맵의 답이 노드별로 적힌다', items.some((k) => k.startsWith('affect:')), items.join(','))
check('맵의 답이 단어 일정에도 적힌다', Boolean(stored.cards?.['affect:en_ko']))

/* ── 복습 ───────────────────────────────────────────────────────────────── */

await page.goto(`${BASE}/vault`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
check('복습 화면이 뜬다', (await page.getByText('복습', { exact: false }).count()) > 0)
await page.getByRole('button', { name: /예정/ }).click()
await page.waitForTimeout(150)
check('예정 탭이 눌린다',
  (await page.getByRole('button', { name: /예정/ }).getAttribute('aria-current')) === 'page')

/* ── 시험 ───────────────────────────────────────────────────────────────── */

await page.goto(`${BASE}/study/session?scope=saved&dir=en_ko`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
check('담은 것 시험이 문제를 낸다', (await page.getByText(/^1 \/ \d+$/).count()) > 0)

// 시험의 보기는 한 칸에 하나씩 쌓인다.
const picks = page.locator('button[class*="rounded-control"][class*="border-line"]')
const pickCount = await picks.count()
await picks.first().click().catch(() => {})
await page.waitForTimeout(300)
check('시험이 채점한다',
  (await page.getByText(/정답이에요|다시 만나볼게요/).count()) > 0, `보기 ${pickCount}개`)
check('다음 복습 날짜가 보인다', (await page.getByText('다음 복습').count()) > 0)

/* ── 옛 주소 ────────────────────────────────────────────────────────────── */

await page.goto(`${BASE}/map?tab=saved`, { waitUntil: 'domcontentloaded' })
await page.waitForURL('**/study', { timeout: 5000 }).catch(() => {})
check('옛 /map 주소가 목록으로 간다', page.url().endsWith('/study'), page.url())

console.log('\n통과 ' + ok.length + '개')
for (const l of ok) console.log('  ✓ ' + l)
if (bad.length) { console.log('\n실패 ' + bad.length + '개'); for (const l of bad) console.log('  ✗ ' + l) }
if (errors.length) { console.log('\n브라우저 오류 ' + errors.length + '개'); for (const e of errors.slice(0, 8)) console.log('  ! ' + e) }

await browser.close()
process.exit(bad.length || errors.length ? 1 : 0)
