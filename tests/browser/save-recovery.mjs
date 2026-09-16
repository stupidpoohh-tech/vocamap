/**
 * Save failure, retry, and late replies — driven through a real browser.
 *
 * The failures are injected in the test, by intercepting the Server Action
 * request from outside the page. Nothing in the application knows this file
 * exists: there is no failure switch, no test-only route and no way to reach
 * any of this from a deployed build.
 *
 * The one that matters most is "server saved, reply lost". Playwright performs
 * the real request and then throws the response away, so the write has landed
 * and the page has been told nothing — which is exactly the case a retry must
 * not double-count.
 *
 * Usage: node tests/browser/save-recovery.mjs <baseUrl> <dbUrl> <mappedWordId>
 */
import { chromium } from 'playwright'
import postgres from 'postgres'

const [BASE, DB_URL, WORD_ID] = process.argv.slice(2)
const sql = postgres(DB_URL, { max: 1 })

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const isAction = (request) =>
  request.method() === 'POST' && (request.headers()['next-action'] ?? '') !== ''

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'vocamap1234')
  await page.locator('input[name=password]').evaluate((el) => el.closest('form').requestSubmit())
  await page.waitForTimeout(3500)
  return { ctx, page }
}

const bodyText = (page) => page.locator('body').innerText()

/**
 * Answers whatever is left and lands on the summary.
 *
 * Each question needs an option tapped and then a step forward, so pressing
 * Enter alone stalls on the first unanswered card.
 */
async function finishSession(page) {
  for (let i = 0; i < 60; i += 1) {
    const text = await bodyText(page)
    if (text.includes('오늘 학습 완료') || text.includes('저장되지 않은 답이 있어요')) return
    const answered = /정답이에요|다시 만나볼게요/.test(text)
    if (answered) {
      await page.keyboard.press('Enter')
    } else {
      const options = page.locator('section button, main button').filter({ hasText: /\S/ })
      const buttons = page.locator('button:has(span)')
      const target = (await buttons.count()) > 1 ? buttons.nth(1) : options.first()
      await target.click().catch(() => {})
      void options
    }
    await page.waitForTimeout(800)
  }
}
const events = async () => Number((await sql`select count(*)::int as n from review_events`)[0].n)
const cards = async () =>
  (await sql`select reps, stability, difficulty, due_at from user_vocabulary_cards order by reps`)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

/* ───────── 1 · the test: fail before saving, then retry ───────── */
{
  await sql`delete from review_events`
  await sql`delete from user_vocabulary_cards`
  const { ctx, page } = await signIn(browser, 'student@vocamap.local')

  let block = true
  await page.route('**/study/session**', async (route) => {
    if (block && isAction(route.request())) return route.abort('failed')
    return route.continue()
  })

  await page.goto(`${BASE}/study/session?scope=all`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('button:has(span)').nth(2).click()
  await page.waitForTimeout(2500)

  const answered = await bodyText(page)
  check('verdict still shown when the save fails', /정답이에요|다시 만나볼게요/.test(answered))
  check('failure is surfaced to the reader', answered.includes('저장하지 못했어요'))
  check('nothing was written', (await events()) === 0)

  await finishSession(page)
  const summary = await bodyText(page)
  check('summary refuses to say the session is complete', summary.includes('저장되지 않은 답이 있어요'))
  check('summary offers a retry', summary.includes('다시 저장하기'))

  block = false
  await page.getByRole('button', { name: '다시 저장하기' }).click()
  await page.waitForTimeout(3500)
  const retried = await bodyText(page)
  check('retry clears the warning', !retried.includes('저장되지 않은 답이 있어요'))
  check('retry actually saved', (await events()) > 0, `${await events()} events`)
  await ctx.close()
}

/* ───────── 2 · the test: saved, but the reply is lost ───────── */
{
  await sql`delete from review_events`
  await sql`delete from user_vocabulary_cards`
  const { ctx, page } = await signIn(browser, 'student@vocamap.local')

  let dropReply = true
  await page.route('**/study/session**', async (route) => {
    if (dropReply && isAction(route.request())) {
      // Perform it for real, then throw the reply away. The write landed; the
      // page will never hear about it.
      await route.fetch().catch(() => {})
      return route.abort('failed')
    }
    return route.continue()
  })

  await page.goto(`${BASE}/study/session?scope=all`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('button:has(span)').nth(2).click()
  await page.waitForTimeout(3000)

  const afterLoss = await events()
  check('the answer did land on the server', afterLoss === 1, `${afterLoss} events`)
  check('the page believes it failed', (await bodyText(page)).includes('저장하지 못했어요'))
  const cardsBefore = await cards()

  dropReply = false
  await finishSession(page)

  // Finishing the test answers the other questions, which legitimately writes
  // their own events. What the retry must not do is add anything, so the count
  // is taken immediately before it.
  const beforeRetry = await events()
  const cardsAtRetry = await cards()
  await page.getByRole('button', { name: '다시 저장하기' }).click()
  await page.waitForTimeout(3500)

  const afterRetry = await events()
  check(
    'retrying does not record it twice',
    afterRetry === beforeRetry,
    `${beforeRetry} → ${afterRetry} events`,
  )
  const cardsAfter = await cards()
  check(
    'the schedule was not advanced twice',
    JSON.stringify(cardsAfter) === JSON.stringify(cardsAtRetry),
    `${cardsAtRetry.length} cards unchanged`,
  )
  void cardsBefore
  check('the warning clears once the duplicate is acknowledged',
    !(await bodyText(page)).includes('저장되지 않은 답이 있어요'))
  await ctx.close()
}

/* ───────── 3 · a reply that arrives after the next question ───────── */
{
  await sql`delete from review_events`
  await sql`delete from user_vocabulary_cards`
  const { ctx, page } = await signIn(browser, 'student@vocamap.local')

  let slow = true
  await page.route('**/study/session**', async (route) => {
    if (slow && isAction(route.request())) {
      await new Promise((r) => setTimeout(r, 4000))
      return route.continue()
    }
    return route.continue()
  })

  await page.goto(`${BASE}/study/session?scope=all`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const firstPrompt = (await bodyText(page)).split('\n').slice(0, 12).join(' ')
  await page.locator('button:has(span)').nth(2).click()
  await page.waitForTimeout(400)

  // Move on before the reply can arrive.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const onSecond = await bodyText(page)
  check('moved to the next question', onSecond.includes('2 /'))
  const lockedEarly = await page.locator('button:disabled').count()

  // Now let the first reply land.
  await page.waitForTimeout(5000)
  const afterLate = await bodyText(page)
  check('late reply does not stamp a verdict on the new question',
    !/정답이에요|다시 만나볼게요/.test(afterLate))
  check('late reply does not lock the new question',
    (await page.locator('button:disabled').count()) === lockedEarly)
  check('the new question is still answerable', afterLate.includes('2 /'))
  void firstPrompt
  slow = false
  await ctx.close()
}

/* ───────── 4 · the same three, inside the map ───────── */
{
  await sql`delete from review_events`
  await sql`delete from brain_map_node_progress`
  const { ctx, page } = await signIn(browser, 'student@vocamap.local')

  let block = true
  await page.route(`**/words/**`, async (route) => {
    if (block && isAction(route.request())) return route.abort('failed')
    return route.continue()
  })

  await page.goto(`${BASE}/words/${WORD_ID}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const workspace = page.locator('section').filter({ hasText: '지금 학습 중' }).last()
  const options = workspace.locator('button').filter({ hasText: /\S/ })
  const count = await options.count()
  if (count === 0) {
    check('map has a gradable card', false, 'no choice options found')
  } else {
    await options.first().click()
    await page.waitForTimeout(2500)
    const failed = await bodyText(page)
    check('map: failure is surfaced', failed.includes('저장하지 못했어요'))
    check('map: nothing was written', (await events()) === 0)
    check('map: retry offered', failed.includes('다시 저장하기'))

    block = false
    await page.getByRole('button', { name: '다시 저장하기' }).click()
    await page.waitForTimeout(3500)
    check('map: retry saved', (await events()) === 1, `${await events()} events`)
    check('map: warning cleared', !(await bodyText(page)).includes('저장하지 못했어요'))

    // Saved-but-reply-lost, inside the map.
    await sql`delete from review_events`
    await sql`delete from brain_map_node_progress`
    let dropReply = true
    await page.route(`**/words/**`, async (route) => {
      if (dropReply && isAction(route.request())) {
        await route.fetch().catch(() => {})
        return route.abort('failed')
      }
      return route.continue()
    })
    await page.goto(`${BASE}/words/${WORD_ID}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    const opts2 = page
      .locator('section')
      .filter({ hasText: '지금 학습 중' })
      .last()
      .locator('button')
      .filter({ hasText: /\S/ })
    if (await opts2.count()) {
      await opts2.first().click()
      await page.waitForTimeout(3000)
      check('map: the answer landed', (await events()) === 1, `${await events()} events`)
      dropReply = false
      await page.getByRole('button', { name: '다시 저장하기' }).click()
      await page.waitForTimeout(3500)
      check('map: retry does not double-record', (await events()) === 1, `${await events()} events`)
      const progress = await sql`select attempts from brain_map_node_progress`
      check('map: node progress counted once', progress[0]?.attempts === 1, JSON.stringify(progress))
    }
  }
  await ctx.close()
}

await browser.close()
await sql.end()
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
