import {
  collocationExercises,
  meaningExercises,
  wordFamilyExercises,
} from '@/lib/learning/exercises'
import {
  EYEBROW,
  PROGRESS_NODE,
  selectMapNodes,
  type SemanticNode,
} from '@/lib/learning/semantic-nodes'
import { allWords, mapFor, type BrainMap, type Word } from '.'

/**
 * 파일에 적힌 맵 하나를 학생이 보는 노드들로 바꾼다 — 빌드할 때 한 번.
 *
 * 예전에는 `buildSemanticMap` 이 같은 일을 요청마다 했다. 그 함수는 한 화면을
 * 그리려고 Postgres 를 여섯 번 왕복했는데, 그중 넷은 "이 학생이 이 노드를 몇 번
 * 맞혔나"를 묻는 것이었다. 콘텐츠는 모두에게 같고 기록은 그 폰에만 있으니,
 * 둘을 갈라 놓으면 서버가 할 일이 없다. 여기서 만드는 것은 모두에게 같은
 * 쪽이고, 등급과 추천은 브라우저가 자기 기록을 보고 얹는다.
 *
 * 그래서 노드의 `status` 는 전부 `unseen` 이고 `recommended` 는 전부 거짓이다.
 * 거짓말이 아니라 '아직 모른다'는 뜻이다 — 미리 구워 둔 HTML 은 누가 볼지
 * 모르고, 아는 척하면 남의 진도가 내 화면에 찍힌다.
 */

/** 답 기록이 묶이는 이름. 단어와 자리에서 나오므로 다시 빌드해도 그대로다. */
const itemId = (slug: string, kind: string, index: number) => `${slug}:${kind}${index}`

export function staticNodes(word: Word, map: BrainMap, rivals: string[]): SemanticNode[] {
  const slug = word.slug
  const nodes: SemanticNode[] = []

  // 문장과 연어·파생어는 문제를 만드는 쪽이 id 로 서로를 가려내므로, 여기서
  // 먼저 이름을 붙여 둔다.
  const sentences = map.sentences.map((s, i) => ({
    id: itemId(slug, 's', i),
    text: s.text,
    ko: s.ko,
    targetMeaning: s.target,
    highlight: s.highlight,
    difficulty: null,
  }))
  const collocations = map.collocations.map((c, i) => ({
    id: itemId(slug, 'c', i),
    expression: c.expression,
    ko: c.ko,
    exampleSentence: c.example,
    importance: c.importance,
  }))
  const family = map.family.map((f, i) => ({
    id: itemId(slug, 'f', i),
    lemma: f.lemma,
    partOfSpeech: f.pos ?? '',
    ko: f.ko,
    exampleSentence: f.example,
  }))

  const base = {
    status: 'unseen' as const,
    recommended: false,
    onMap: false,
  }

  // ── 핵심 의미 ──────────────────────────────────────────────────────────
  // 세트에 적힌 뜻이 먼저다. 쉼표로 이어 적는 일이 흔해서 — "문제, 쟁점,
  // 문제" — 갈라서 겹치는 것을 지운다.
  const glosses = [
    ...new Set(
      word.ko
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]
  if (glosses.length || map.coreKo) {
    const label = glosses.slice(0, 2).join(', ') || map.meanings[0]?.ko || map.lemma
    const id = itemId(slug, 'core', 0)
    nodes.push({
      ...base,
      id,
      kind: 'coreMeaning',
      label,
      secondaryLabel: map.coreKo,
      eyebrow: EYEBROW.coreMeaning,
      importance: 0.95,
      relationStrength: 1,
      progressNode: PROGRESS_NODE.coreMeaning,
      itemId: id,
      exercises: meaningExercises({
        label,
        sense: map.meanings[0]?.ko ?? label,
        sentences,
        meaningCoreKo: map.coreKo,
        connectionNote: map.meanings[0]?.note,
        enDefinition: map.meanings[0]?.en,
        enDefinitionKo: map.meanings[0]?.enKo,
        rivalDefinitions: rivals,
        lemma: map.lemma,
      }),
    })
  }

  // ── 그 다음 뜻들 ───────────────────────────────────────────────────────
  map.meanings.slice(1).forEach((meaning, index) => {
    const id = itemId(slug, 'm', index + 1)
    nodes.push({
      ...base,
      id,
      kind: 'secondaryMeaning',
      label: meaning.chunk?.trim() || meaning.ko,
      secondaryLabel: meaning.chunk ? meaning.ko : meaning.en,
      eyebrow: EYEBROW.secondaryMeaning,
      importance: Math.max(0.3, 0.62 - index * 0.12),
      relationStrength: Math.max(0.35, 0.7 - index * 0.12),
      progressNode: PROGRESS_NODE.secondaryMeaning,
      itemId: id,
      exercises: meaningExercises({
        label: meaning.ko,
        sense: meaning.ko,
        sentences,
        meaningCoreKo: map.coreKo,
        connectionNote: meaning.note,
        enDefinition: meaning.en,
        enDefinitionKo: meaning.enKo,
        rivalDefinitions: rivals,
        lemma: map.lemma,
      }),
    })
  })

  // ── 함께 쓰는 표현 ─────────────────────────────────────────────────────
  for (const collocation of collocations) {
    nodes.push({
      ...base,
      id: collocation.id,
      kind: 'collocation',
      label: collocation.expression,
      secondaryLabel: collocation.ko,
      eyebrow: EYEBROW.collocation,
      importance:
        collocation.importance === 1 ? 0.82 : collocation.importance === 2 ? 0.66 : 0.52,
      relationStrength: collocation.importance === 1 ? 0.85 : 0.6,
      progressNode: PROGRESS_NODE.collocation,
      itemId: collocation.id,
      exercises: collocationExercises({ lemma: map.lemma, collocation, siblings: collocations }),
    })
  }

  // ── 파생어 ─────────────────────────────────────────────────────────────
  for (const member of family) {
    nodes.push({
      ...base,
      id: member.id,
      kind: 'wordFamily',
      label: member.lemma,
      secondaryLabel: member.ko,
      eyebrow: EYEBROW.wordFamily,
      importance: 0.44,
      relationStrength: 0.5,
      progressNode: PROGRESS_NODE.wordFamily,
      itemId: member.id,
      exercises: wordFamilyExercises({ member, family }),
    })
  }

  selectMapNodes(nodes)
  return nodes
}

/**
 * 옆에 있는 단어들의 영영 풀이 — 핵심 의미 문제의 오답으로 쓴다.
 *
 * 선생님이 같은 세트에 넣은 단어가 먼저다. 시험지에 함께 나오는 단어가
 * 그것들이고, 고르기 어려운 오답일수록 문제가 된다. 모자라면 나머지에서 채운다.
 */
export function rivalDefinitions(word: Word, limit = 12): string[] {
  const sameSet: string[] = []
  const rest: string[] = []

  for (const other of allWords()) {
    if (other.slug === word.slug) continue
    const en = mapFor(other.slug)?.meanings[0]?.en?.trim()
    if (!en) continue
    ;(other.sets.some((s) => word.sets.includes(s)) ? sameSet : rest).push(en)
  }

  return [...new Set([...sameSet, ...rest])].slice(0, limit)
}

/** 한 단어의 노드 전부. 화면이 부르는 것은 이것 하나다. */
export function nodesFor(word: Word): SemanticNode[] | null {
  const map = mapFor(word.slug)
  if (!map) return null
  return staticNodes(word, map, rivalDefinitions(word))
}
