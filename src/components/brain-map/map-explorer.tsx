'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapLegend, MapOverflow, SemanticMap } from '@/components/brain-map/semantic-map'
import { Workspace, type WorkspaceAnswer } from '@/components/brain-map/workspace'
import { recommend, type SemanticNode } from '@/lib/learning/semantic-nodes'
import { itemStatus, read, recordAnswer, recordItem } from '@/learning/store'

/**
 * 맵 위, 문제 아래 — 한 화면에서.
 *
 * 노드를 고르는 것은 주소를 바꾸지 않는다. 지금 이 단어의 어느 연결을 붙들고
 * 있는지가 맵에 보여야 하기 때문이다.
 *
 * 예전 화면(`words/[id]/brain-map-explorer.tsx`)과 하는 일은 같고, 답이 가는
 * 곳이 다르다. 그쪽은 서버로 보내 다시 채점받고 저장이 실패하면 "저장하지
 * 못했어요"를 띄웠다. 여기서는 채점도 저장도 이 브라우저에서 끝나므로 보낼
 * 것도, 실패할 것도 없다 — 대신 이 폰을 벗어나지 않는다.
 */
export function MapExplorer({
  slug,
  lemma,
  nodes: content,
}: {
  slug: string
  lemma: string
  /** 모두에게 같은 것. 빌드할 때 구워졌고 등급은 아직 비어 있다. */
  nodes: SemanticNode[]
}) {
  /**
   * 내 기록을 얹은 노드들.
   *
   * 첫 그림에는 넣지 않는다. 미리 구워 둔 HTML 은 모두에게 같은 것이고, 거기에
   * 내 등급이 찍혀 있으면 서버가 그릴 때와 브라우저가 그릴 때가 어긋난다
   * (hydration). 그려진 뒤에 한 번 얹는다.
   */
  const [nodes, setNodes] = useState(content)
  const [mine, setMine] = useState(false)

  useEffect(() => {
    const saved = read()
    const next = content.map((n) => ({ ...n, status: itemStatus(saved, n.itemId) }))
    recommend(next)
    setNodes(next)
    setMine(true)
  }, [content])

  const recommendedId = useMemo(() => nodes.find((n) => n.recommended)?.id ?? null, [nodes])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 고른 것이 없으면 추천을 연다. 맵의 요점은 문제에 닿는 것이고, 맵은 이미
  // 어디서 시작할지 말하고 있다 — "하나 고르세요"라는 빈 칸을 띄울 이유가 없다.
  const openId = selectedId ?? recommendedId ?? nodes.find((n) => n.exercises.length)?.id ?? null
  // 나머지를 흐리게 하는 것은 고른 데 대한 반응이지 시작 상태가 아니다.
  const [chosen, setChosen] = useState(false)

  const selected = nodes.find((n) => n.id === openId) ?? null

  const handleAnswer: WorkspaceAnswer = (outcome) => {
    // 해석을 읽은 것은 그 해석에 대한 문제를 푼 것이 아니다. 예전에 이것이
    // 정답으로 보내졌고, 카드에 있는 단 하나의 버튼을 누른 것이 맞힌 것으로
    // 세어졌다. 아무것도 적지 않는다.
    if (outcome.kind === 'revealed') return

    const saved = recordItem(outcome.node.itemId, outcome.correct)
    // 단어의 다음 일정도 같이 움직인다. 맵에서 푼 것도 그 단어를 본 것이다.
    recordAnswer(slug, 'en_ko', {
      correct: outcome.correct,
      responseTimeMs: outcome.responseTimeMs,
    })

    setNodes((prev) => {
      const next = prev.map((n) =>
        n.id === outcome.node.id
          ? { ...n, status: itemStatus(saved, n.itemId) }
          : n,
      )
      // 추천은 등급을 보고 정해지므로, 등급이 움직이면 다시 정해진다. 지금
      // 열어 둔 카드는 건드리지 않는다 — 답한 순간 카드가 바뀌면 방금 받은
      // 해설을 읽을 수 없다.
      recommend(next)
      return next
    })
  }

  const select = (id: string) => {
    setChosen(true)
    setSelectedId((current) => (current === id ? null : id))
  }

  return (
    <div className="mt-5 grid gap-4 sm:mt-8 sm:gap-5 min-[1120px]:grid-cols-[minmax(0,1fr)_25rem] min-[1120px]:grid-rows-[auto_1fr] min-[1120px]:gap-x-10 min-[1120px]:gap-y-6">
      <section className="min-[1120px]:col-start-1 min-[1120px]:row-span-2 min-[1120px]:row-start-1">
        {/* 맵은 축척에 맞춰 그려지므로, 이보다 넓은 칸은 틀을 세로로 키워
            문제를 노트북 화면 밖으로 밀어낸다. */}
        <div className="mx-auto w-full max-w-[37.5rem] min-[1120px]:max-w-none">
          <SemanticMap
            lemma={lemma}
            nodes={nodes}
            selectedId={openId}
            dimOthers={chosen}
            onSelect={select}
          />
        </div>
        {/* 기록을 얹기 전에는 모든 노드가 '아직 안 봄'이라 범례가 띄울 것이
            없다. 얹은 뒤에만 띄운다. */}
        {mine ? <MapLegend statuses={nodes.map((n) => n.status)} /> : null}
      </section>

      <div className="min-[1120px]:col-start-2 min-[1120px]:row-start-1">
        <Workspace node={selected} onAnswer={handleAnswer} />
      </div>

      <div className="pb-2 min-[1120px]:col-start-2 min-[1120px]:row-start-2">
        <MapOverflow nodes={nodes} selectedId={openId} onSelect={select} />
      </div>
    </div>
  )
}
