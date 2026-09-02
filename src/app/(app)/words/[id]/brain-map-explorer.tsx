'use client'

import { useEffect, useState } from 'react'
import { MapLegend, SemanticMap } from '@/components/brain-map/semantic-map'
import { Workspace, type WorkspaceAnswer } from '@/components/brain-map/workspace'
import type { MapReason, SemanticNode } from '@/lib/data/semantic-map'
import { answerNode, openBrainMap } from './actions'

/**
 * Map above, workspace below, on one page.
 *
 * Selecting a node never navigates: the map has to stay visible so the student
 * can see which connection of the word they are working on right now.
 */
export function BrainMapExplorer({
  vocabularyId,
  lemma,
  nodes: initialNodes,
  reasons,
  recommendedNodeId,
}: {
  vocabularyId: string
  lemma: string
  nodes: SemanticNode[]
  reasons: MapReason[]
  recommendedNodeId: string | null
}) {
  const [nodes, setNodes] = useState(initialNodes)
  // Opens on the recommended node rather than on an empty panel telling the
  // student to pick something: the point of the map is to get to a question,
  // and the map already says which one to start with.
  const [selectedId, setSelectedId] = useState<string | null>(
    recommendedNodeId ?? initialNodes.find((n) => n.exercises.length)?.id ?? null,
  )
  // Dimming the rest of the map is a response to a choice, not a starting
  // state — a map that arrives with four of five nodes faded is not a map.
  const [chosen, setChosen] = useState(false)

  // Opening the map is itself a signal — it tells us the recommendation landed.
  useEffect(() => {
    void openBrainMap(vocabularyId)
  }, [vocabularyId])

  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const recommended = nodes.find((n) => n.id === recommendedNodeId) ?? null

  const handleAnswer: WorkspaceAnswer = (input) => {
    // Reflect the node's new state straight away, then persist.
    void answerNode({
      vocabularyId,
      node: input.node.progressNode,
      questionType: questionTypeFor(input.node.kind),
      correct: input.correct,
      responseTimeMs: input.responseTimeMs,
      pairId: input.node.pairId,
      payload: input.payload,
    }).then(() => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === input.node.id
            ? { ...n, status: input.correct ? 'learning' : 'weak' }
            : n,
        ),
      )
    })
  }

  return (
    <div className="mt-5">
      {reasons.length ? <ReasonStrip reasons={reasons} recommended={recommended} /> : null}

      {/* Tighter on a phone: the map should arrive without a scroll. */}
      <section className="mt-4 sm:mt-6">
        <SemanticMap
          lemma={lemma}
          nodes={nodes}
          selectedId={selectedId}
          dimOthers={chosen}
          onSelect={(id) => {
            setChosen(true)
            setSelectedId((current) => (current === id ? null : id))
          }}
        />
        <div className="mt-4 sm:mt-2">
          <MapLegend statuses={nodes.map((n) => n.status)} />
        </div>
      </section>

      {/* Clear of the fixed bottom bar. */}
      <div className="mt-6 pb-4 sm:mt-8">
        <Workspace node={selected} onAnswer={handleAnswer} />
      </div>
    </div>
  )
}

function ReasonStrip({
  reasons,
  recommended,
}: {
  reasons: MapReason[]
  recommended: SemanticNode | null
}) {
  // One strip, two lines. This was a heading, a wrapped list and a separate
  // recommendation sentence — three bands of small grey text ahead of the map
  // they were describing.
  const why = reasons.map((r) => r.text)
  const urgent = reasons.some((r) => r.tone === 'warn')

  return (
    <section className="border-t border-line pt-3 text-[0.8125rem] leading-relaxed">
      <p className="break-keep">
        <span className="text-ink-3">이 단어가 펼쳐진 이유 </span>
        <span className={urgent ? 'text-ink' : 'text-ink-2'}>{why.join(' · ')}</span>
      </p>
      {recommended ? (
        <p className="mt-0.5 break-keep">
          <span className="text-ink-3">추천 시작 </span>
          <span className="text-ink">{recommended.label}</span>
        </p>
      ) : null}
    </section>
  )
}

function questionTypeFor(kind: SemanticNode['kind']) {
  switch (kind) {
    case 'confusable':
      return 'similar_battle' as const
    case 'collocation':
      return 'collocation_cloze' as const
    case 'wordFamily':
      return 'word_family_cloze' as const
    default:
      return 'sentence_translation' as const
  }
}
