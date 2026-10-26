/**
 * Neon 에서 받아 온 export.json 을 손으로 고칠 수 있는 파일들로 가른다.
 *
 * 한 덩어리 JSON 은 옮겨 오기에는 편하지만 고치기에는 나쁘다 — 단어 하나
 * 더하려고 따옴표와 쉼표를 세고 있어야 한다. 그래서 이관은 JSON 으로 한 번
 * 받고, 그 다음부터는 세트마다 탭으로 나뉜 파일을 GitHub 웹에서 고친다.
 *
 * 맵은 사람이 손대는 것이 아니라 그대로 JSON 으로 둔다.
 *
 *   node scripts/export/split.mjs content/export.json
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const source = process.argv[2] ?? 'content/export.json'
const data = JSON.parse(readFileSync(source, 'utf8'))

const SETS = 'content/sets'
const MAPS = 'content/maps'
rmSync(SETS, { recursive: true, force: true })
rmSync(MAPS, { recursive: true, force: true })
mkdirSync(SETS, { recursive: true })
mkdirSync(MAPS, { recursive: true })

/** 파일 이름으로 쓸 수 있게. 세트 이름 자체는 파일 안에 적어 둔다. */
const slug = (s) =>
  s.trim().replace(/[^\p{L}\p{N}가-힣._-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'set'

let words = 0
for (const set of data.sets ?? []) {
  const lines = [
    `# ${set.title}`,
    '#',
    '# 한 줄에 단어 하나. 탭으로 나눈다:  단어 <탭> 뜻 <탭> 품사(없어도 됨)',
    '# 맨 앞이 # 인 줄과 빈 줄은 무시한다.',
    '',
  ]
  for (const w of set.words ?? []) {
    lines.push([w.lemma, w.ko ?? '', w.pos ?? ''].join('\t').replace(/\t+$/, ''))
    words += 1
  }
  writeFileSync(join(SETS, `${slug(set.title)}.tsv`), lines.join('\n') + '\n')
}

for (const map of data.maps ?? []) {
  writeFileSync(join(MAPS, `${slug(map.lemma)}.json`), JSON.stringify(map, null, 2) + '\n')
}

console.log(`세트 ${data.sets?.length ?? 0}개 (단어 ${words}개) → ${SETS}/`)
console.log(`맵 ${data.maps?.length ?? 0}개 → ${MAPS}/`)
console.log(`내보낸 시각: ${data.exportedAt ?? '(없음)'}`)
