import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugify } from '@/content'

/**
 * 로더 자체는 `process.cwd()` 아래의 content/ 를 읽는다. 여기서는 형식을
 * 다루는 규칙만 따로 확인한다 — 선생님이 손으로 고치는 파일이라, 느슨하게
 * 적어도 읽히는 것이 중요하다.
 */

/** 로더의 파서와 같은 규칙. 파일에서 떼어내 시험할 수 있게 옮겨 적었다. */
function parse(text: string) {
  const rows: Array<{ lemma: string; ko: string; pos: string | null }> = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const [lemma = '', ko = '', pos = ''] = line.split('\t').map((c) => c.trim())
    if (!lemma) continue
    const slug = slugify(lemma)
    if (seen.has(slug)) continue
    seen.add(slug)
    rows.push({ lemma, ko, pos: pos || null })
  }
  return rows
}

describe('세트 파일 읽기', () => {
  it('주석과 빈 줄을 건너뛴다', () => {
    const rows = parse('# J1\n#\n\ncave\t동굴\n\nhowever\t그러나\n')
    expect(rows.map((r) => r.lemma)).toEqual(['cave', 'however'])
  })

  it('뜻에 쉼표가 있어도 한 칸으로 읽는다', () => {
    // 탭으로 나누는 이유가 이것이다 — "문제, 쟁점" 같은 뜻이 흔하다.
    const [row] = parse('issue\t문제, 쟁점\tnoun')
    expect(row).toEqual({ lemma: 'issue', ko: '문제, 쟁점', pos: 'noun' })
  })

  it('품사가 없어도 읽는다', () => {
    const [row] = parse('cave\t동굴')
    expect(row?.pos).toBeNull()
  })

  it('뜻이 비어 있어도 단어는 살린다', () => {
    // 뜻을 깜빡하고 올린 적이 실제로 있었다. 그때 단어가 통째로 사라지는 것보다
    // 뜻이 빈 채로 보이는 편이 고치기 쉽다.
    const [row] = parse('wizard')
    expect(row).toEqual({ lemma: 'wizard', ko: '', pos: null })
  })

  it('앞뒤 공백을 떼어 낸다', () => {
    const [row] = parse('  cave  \t  동굴  ')
    expect(row).toEqual({ lemma: 'cave', ko: '동굴', pos: null })
  })

  it('같은 세트에 같은 단어가 두 번 있으면 앞의 것만 쓴다', () => {
    const rows = parse('cave\t동굴\ncave\t굴')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.ko).toBe('동굴')
  })
})

describe('주소로 쓰는 이름', () => {
  it('단어를 그대로 쓴다', () => {
    expect(slugify('however')).toBe('however')
  })

  it('대문자와 공백이 섞여도 주소가 된다', () => {
    expect(slugify('take off')).toBe('take-off')
  })

  it('한글 세트 이름을 살린다', () => {
    expect(slugify('J1 1과')).toBe('J1-1과')
  })

  it('비어 버리면 기본 이름을 준다', () => {
    expect(slugify('!!!')).toBe('set')
  })
})
