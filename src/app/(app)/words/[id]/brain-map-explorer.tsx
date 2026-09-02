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
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
    <div className="mt-6">
      {reasons.length ? <ReasonStrip reasons={reasons} recommended={recommended} /> : null}

      <section className="mt-6">
        <SemanticMap
          lemma={lemma}
          nodes={nodes}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
        />
        <div className="mt-4 sm:mt-2">
          <MapLegend />
        </div>
      </section>

      <div className="mt-8">
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
  return (
    <section className="border-y border-line py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        이 단어가 맵으로 펼쳐진 이유
      </p>
      <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {reasons.map((reason) => (
          <li key={reason.text} className="flex items-center gap-1.5 text-sm break-keep">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                reason.tone === 'warn' ? 'bg-warn' : 'bg-line'
              }`}
            />
            <span className={reason.tone === 'warn' ? '' : 'text-muted'}>{reason.text}</span>
          </li>
        ))}
      </ul>
      {recommended ? (
        <p className="mt-2 text-sm text-muted break-keep">
          추천 시작 · <span className="font-semibold text-ink">{recommended.label}</span>
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
