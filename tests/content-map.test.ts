import { describe, expect, it } from 'vitest'
import { allWords, mapFor, wordBySlug } from '@/content'
import { nodesFor, rivalDefinitions, staticNodes } from '@/content/map'
import { recommend, type SemanticNode } from '@/lib/learning/semantic-nodes'

/**
 * 파일에 적힌 맵이 화면의 노드가 되는 길.
 *
 * 운영 콘텐츠를 상대로 확인한다. 꾸며 낸 자료에서만 지켜지는 규칙은 규칙이
 * 아니고, 이 규칙들은 예전에 `buildSemanticMap` 이 데이터베이스를 상대로
 * 지키던 것이다.
 */

const mapped = () => allWords().filter((w) => mapFor(w.slug))

describe('맵이 있는 단어마다 노드가 만들어진다', () => {
  it('맵 167개가 모두 노드를 낸다', () => {
    const words = mapped()
    expect(words.length).toBe(167)
    for (const word of words) {
      const nodes = nodesFor(word)
      expect(nodes, word.slug).not.toBeNull()
      expect(nodes!.length, word.slug).toBeGreaterThan(0)
    }
  })

  it('맵이 없는 단어는 노드도 없다', () => {
    const bare = allWords().find((w) => !mapFor(w.slug))
    expect(bare).toBeDefined()
    expect(nodesFor(bare!)).toBeNull()
  })

  it('노드의 이름은 단어와 자리에서 나오므로 다시 만들어도 같다', () => {
    const word = wordBySlug('affect')!
    const once = nodesFor(word)!.map((n) => n.itemId)
    const twice = nodesFor(word)!.map((n) => n.itemId)
    expect(twice).toEqual(once)
    // 기록이 이 이름으로 묶이므로, 바뀌면 그 학생의 진도가 사라진다.
    expect(once.every((id) => id.startsWith('affect:'))).toBe(true)
  })
})

describe('맵에 올라가는 것은 몇 개뿐이다', () => {
  it('핵심 의미는 올라가고 파생어는 올라가지 않는다', () => {
    for (const word of mapped()) {
      const nodes = nodesFor(word)!
      const core = nodes.find((n) => n.kind === 'coreMeaning')
      if (core) expect(core.onMap, word.slug).toBe(true)
      // 파생어 목록은 찾아보는 자료다. 맵에 올리면 그 자리에서 가장 도움이
      // 덜 되는 것에 학생의 주의를 쓴다.
      expect(nodes.filter((n) => n.kind === 'wordFamily' && n.onMap), word.slug).toEqual([])
    }
  })

  it('다섯 개를 넘지 않는다', () => {
    for (const word of mapped()) {
      expect(nodesFor(word)!.filter((n) => n.onMap).length, word.slug).toBeLessThanOrEqual(5)
    }
  })
})

describe('무엇부터 할지', () => {
  const nodes = (): SemanticNode[] => nodesFor(wordBySlug('affect')!)!

  it('흔들리는 것이 아직 안 본 것보다 먼저다', () => {
    const list = nodes()
    const weak = list.find((n) => n.exercises.length && !n.onMap)!
    weak.status = 'weak'
    expect(recommend(list)).toBe(weak.id)
  })

  it('고른 것 하나만 추천으로 남는다', () => {
    const list = nodes()
    const id = recommend(list)
    expect(list.filter((n) => n.recommended).map((n) => n.id)).toEqual([id])
  })

  it('문제가 없는 노드는 추천되지 않는다', () => {
    const list = nodes()
    const picked = list.find((n) => n.id === recommend(list))!
    expect(picked.exercises.length).toBeGreaterThan(0)
  })
})

describe('오답으로 쓸 영영 풀이', () => {
  it('자기 자신은 들어가지 않는다', () => {
    const word = wordBySlug('affect')!
    const own = mapFor(word.slug)!.meanings[0]!.en
    expect(rivalDefinitions(word)).not.toContain(own)
  })

  it('같은 세트의 단어가 먼저 온다', () => {
    const word = mapped().find((w) => {
      const siblings = allWords().filter(
        (o) => o.slug !== w.slug && o.sets.some((s) => w.sets.includes(s)) && mapFor(o.slug)?.meanings[0]?.en,
      )
      return siblings.length >= 2
    })!
    const sameSet = new Set(
      allWords()
        .filter((o) => o.slug !== word.slug && o.sets.some((s) => word.sets.includes(s)))
        .map((o) => mapFor(o.slug)?.meanings[0]?.en?.trim())
        .filter(Boolean),
    )
    expect(sameSet.has(rivalDefinitions(word)[0])).toBe(true)
  })
})

describe('영영 풀이의 한국어 해석', () => {
  it('파일에 있는 것이 노드까지 따라온다', () => {
    // c59816a 에서 내보내기 쿼리가 이 칸을 빠뜨린 것을 고쳤다. 화면까지
    // 닿는지는 그것과 다른 질문이다.
    const map = mapFor('affect')!
    expect(map.meanings[0]!.enKo).toBeTruthy()

    const word = wordBySlug('affect')!
    const nodes = staticNodes(word, map, [])
    const asked = nodes.flatMap((n) => n.exercises).map((e) => JSON.stringify(e)).join('\n')
    expect(asked).toContain(map.meanings[0]!.enKo!)
  })
})
