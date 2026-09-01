import { chromium } from 'playwright'
const B='http://localhost:3300'
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' })
const errs=[]

// 1) 선생님 회원가입 (사용자가 배포 후 실제로 할 첫 동작)
const t = await browser.newPage({ viewport:{width:390,height:844} })
t.on('pageerror', e=>errs.push('teacher: '+e))
await t.goto(`${B}/login`)
await t.click('button:has-text("회원가입")')
await t.fill('input[name=displayName]','박선생')
await t.selectOption('select[name=role]','teacher')
await t.fill('input[name=email]','park@example.com')
await t.fill('input[name=password]','realpassword123')
await t.click('button:has-text("시작하기"):not([type=button])')
await t.waitForURL('**/teacher',{timeout:30000})
console.log('1. 선생님 가입 → OK')

// 2) 학생 회원가입
const s = await browser.newPage({ viewport:{width:390,height:844} })
s.on('pageerror', e=>errs.push('student: '+e))
await s.goto(`${B}/login`)
await s.click('button:has-text("회원가입")')
await s.fill('input[name=displayName]','이학생')
await s.fill('input[name=email]','lee@example.com')
await s.fill('input[name=password]','realpassword123')
await s.click('button:has-text("시작하기"):not([type=button])')
await s.waitForURL('**/study',{timeout:30000})
console.log('2. 학생 가입 → OK')

// 3) 선생님이 학생 연결
await t.goto(`${B}/teacher`); await t.waitForTimeout(500)
await t.fill('input[name=email]','lee@example.com')
await t.click('button:has-text("학생 추가")')
await t.waitForTimeout(2500)
console.log('3. 학생 추가 →', (await t.locator('.text-good').first().innerText().catch(()=>'실패')))

// 4) 단어 붙여넣기 — seed에 이미 있는 단어 2개 + 새 단어 1개
await t.fill('input[name=title]','이번 주 과외 단어')
await t.fill('textarea[name=words]','maintain, 유지하다, verb\nissue, 문제, noun\npersuade, 설득하다, verb')
await t.selectOption('select[name=studentId]',{ index:1 })
await t.click('button:has-text("가져오기")')
await t.waitForTimeout(3000)
console.log('4. 단어 가져오기 →', (await t.locator('.text-good').last().innerText().catch(()=>'실패')))

// 5) 학생이 학습 가능한지 + seed Brain Map이 붙어있는지
await s.goto(`${B}/study`); await s.waitForTimeout(1200)
const home = await s.locator('body').innerText()
console.log('5. 학생 홈 →', /학습 시작 · (\d+)문제/.exec(home)?.[0] ?? '학습 없음')
await s.screenshot({path:'/tmp/shots/v-home.png', fullPage:true})

await s.goto(`${B}/words?q=maintain`); await s.waitForTimeout(800)
const h = await s.locator('a[href^="/words/"]').first().getAttribute('href')
await s.goto(`${B}${h}`); await s.waitForTimeout(1200)
console.log('6. maintain Brain Map 노드 수 →', await s.locator('button[aria-label]').count())
await s.screenshot({path:'/tmp/shots/v-map.png', fullPage:true})

console.log('ERRORS:', errs.length?errs.slice(0,3):'없음')
await browser.close()
