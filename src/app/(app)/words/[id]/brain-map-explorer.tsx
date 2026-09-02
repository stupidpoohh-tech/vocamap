'use client'

import { useEffect, useState } from 'react'
import { MapLegend, SemanticMap } from '@/components/brain-map/semantic-map'
import { Workspace, type WorkspaceAnswer } from '@/components/brain-map/workspace'
import type { SemanticNode } from '@/lib/data/semantic-map'
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
  recommendedNodeId,
}: {
  vocabularyId: string
  lemma: string
  nodes: SemanticNode[]
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

  // Straight to the map. The two strips that used to sit here — the memory
  // state of each direction, and a paragraph explaining why the word was
  // expanded — pushed the thing this page exists for below the fold.
  return (
    <div className="mt-6">
      <section>
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
