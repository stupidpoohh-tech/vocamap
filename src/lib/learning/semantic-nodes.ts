import type { NodeType } from './nodes'
import type { Exercise } from './exercises'

/**
 * 맵이 노드를 고르고 등급을 매기는 규칙 — DB 를 모른다.
 *
 * 예전에는 이 규칙들이 `src/lib/data/semantic-map.ts` 안에, 질의와 한 덩어리로
 * 있었다. 그래서 브라우저가 같은 규칙을 쓸 수 없었다. 규칙 자체는 들어온
 * 숫자만 보는 순수 함수라 옮겨 올 것이 없었고, 떼어 내니 서버와 브라우저가
 * 같은 것을 쓴다.
 *
 * 등급이 왜 브라우저로 가야 하는지: 노드의 등급은 그 학생이 그것을 몇 번
 * 맞혔는지로 정해진다. 기록이 브라우저에 사는 지금, 등급도 브라우저에서
 * 매겨진다 — 서버는 그 학생이 누구인지조차 모른다.
 */

export type NodeKind = 'coreMeaning' | 'secondaryMeaning' | 'collocation' | 'wordFamily'

export type NodeStatus = 'unseen' | 'learning' | 'needsReview' | 'weak' | 'completed'

/** 채점 기록이 붙을 수 있는 문제. 서버가 채점할 때만 `token` 이 붙는다. */
export type IssuedExercise = Exercise & { token?: string }

export type SemanticNode = {
  id: string
  kind: NodeKind
  /** 단어 그 자체. 카드에서 가장 큰 글자다. */
  label: string
  /** 한국어 뜻이나 짧은 풀이 한 줄. */
  secondaryLabel: string | null
  /** 아주 작은 꼬리표. 본문이 되는 일은 없다. */
  eyebrow: string
  importance: number
  relationStrength: number
  status: NodeStatus
  recommended: boolean
  /** 답이 어느 칸으로 세어지는지. */
  progressNode: NodeType
  /**
   * 이 노드가 맵에 자리를 얻을 만한지.
   *
   * 배치가 아니라 교육 과정의 판단이라 그리는 쪽이 아니라 여기서 정한다 —
   * Brain Map 은 학생 머리에 남아야 하는 몇 개의 연결이고, 맞는 말이지만
   * 자리를 얻지 못한 것은 자리를 얻은 것의 값을 치른다. 떨어진 것도 맵 아래
   * 목록에서는 그대로 닿는다.
   */
  onMap: boolean
  /** 답 기록이 묶이는 이름. 노드별 진도가 이것으로 세어진다. */
  itemId: string
  exercises: IssuedExercise[]
}

const EYEBROW: Record<NodeKind, string> = {
  coreMeaning: '핵심 의미',
  secondaryMeaning: '확장 의미',
  collocation: '함께 쓰는 표현',
  wordFamily: '파생어',
}

export const PROGRESS_NODE: Record<NodeKind, NodeType> = {
  coreMeaning: 'meaning_core',
  secondaryMeaning: 'sentences',
  collocation: 'collocations',
  wordFamily: 'word_family',
}

export function nodeEyebrow(kind: NodeKind): string {
  return EYEBROW[kind]
}

export { EYEBROW }

/* ───────────────────────────── 노드의 등급 ───────────────────────────── */

export type ItemTally = { attempts: number; correct: number }

export function statusFor(tally: ItemTally | undefined): NodeStatus {
  if (!tally || tally.attempts === 0) return 'unseen'
  const accuracy = tally.correct / tally.attempts
  if (accuracy < 0.5) return 'weak'
  if (tally.attempts >= 3 && accuracy >= 0.8) return 'completed'
  if (accuracy < 0.75) return 'needsReview'
  return 'learning'
}

/* ──────────────────────────── 맵에 올릴 노드 ──────────────────────────── */

/**
 * 맵에 올라갈 몇 개를 순서대로 고른다 — 핵심 의미 하나, 학생이 실제로 만날
 * 연어 한두 개, 그리고 자리가 남을 때만 확장 의미 하나.
 *
 * 파생어는 일부러 한 번도 고르지 않는다. 파생어 목록은 찾아보는 자료이고,
 * 맵에 올리면 그 자리에서 가장 도움이 덜 되는 것에 학생의 주의를 쓴다.
 */
export const MAP_NODE_BUDGET = 5
const MAP_NODE_TARGET = 3

export function selectMapNodes(nodes: SemanticNode[]): void {
  const strongestFirst = (a: SemanticNode, b: SemanticNode) => b.importance - a.importance
  const of = (kind: NodeKind) => nodes.filter((n) => n.kind === kind).sort(strongestFirst)

  const picked: SemanticNode[] = []
  const take = (node: SemanticNode | undefined) => {
    if (!node || picked.length >= MAP_NODE_BUDGET || picked.includes(node)) return
    picked.push(node)
  }

  take(of('coreMeaning')[0])
  for (const collocation of of('collocation').slice(0, 2)) take(collocation)
  if (picked.length < MAP_NODE_TARGET) take(of('secondaryMeaning')[0])

  for (const node of picked) node.onMap = true
}

/**
 * 무엇부터 할지. 등급을 보고 정하므로 기록을 가진 쪽에서 부른다.
 *
 * 맵에 올라간 노드가 먼저다 — 비슷하게 좋은 후보가 맵에 있으면, 추천은 눈이
 * 이미 가 있는 곳에 내린다.
 */
export function recommend(nodes: SemanticNode[]): string | null {
  const startable = nodes
    .filter((n) => n.exercises.length > 0)
    .sort((a, b) => Number(b.onMap) - Number(a.onMap))

  const picked =
    // 흔들리는 것이 그냥 중요한 것을 이긴다. 중요한 것에 흔들리는 것이
    // 애초에 이 단어를 펼친 이유다.
    startable.find((n) => n.status === 'weak' && n.importance >= 0.7) ??
    startable.find((n) => n.status === 'weak') ??
    startable.find((n) => n.status === 'needsReview') ??
    startable.find((n) => n.status === 'unseen' && n.importance >= 0.85) ??
    startable[0] ??
    null

  for (const node of nodes) node.recommended = node === picked
  return picked?.id ?? null
}
