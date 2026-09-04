'use client'

import { useEffect, useState } from 'react'
import { MapLegend, MapOverflow, SemanticMap } from '@/components/brain-map/semantic-map'
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
  alreadyOpened,
}: {
  vocabularyId: string
  lemma: string
  nodes: SemanticNode[]
  recommendedNodeId: string | null
  /** Whether this student has opened this word's map before. */
  alreadyOpened: boolean
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

  // Opening the map is itself a signal — it tells us the recommendation
  // landed. That is a fact about the first time, so it is recorded once. It
  // used to fire on every visit: a server round trip, a session lookup and two
  // writes each time a student reopened a word they were revising.
  useEffect(() => {
    if (alreadyOpened) return
    void openBrainMap(vocabularyId)
  }, [alreadyOpened, vocabularyId])

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
  const select = (id: string) => {
    setChosen(true)
    setSelectedId((current) => (current === id ? null : id))
  }

  // Map, then the question it leads to, then whatever did not fit. The map and
  // the card are the screen; everything else waits until after them.
  return (
    // One grid, placed twice.
    //
    // Stacked on a phone, because there is one column and the map has to come
    // first. Side by side once there is room for both at full size, because
    // that is what the screen is actually about: you click a node on the left
    // and the question on the right changes. Stacked, that relationship costs
    // a scroll to see, and a wide screen spends its width on empty margin
    // instead — a phone layout stretched across a desktop.
    //
    // 1120px is not a taste call: below it the map column would be narrower
    // than the width its clearances were verified at.
    <div className="mt-5 grid gap-4 sm:mt-8 sm:gap-5 min-[1120px]:grid-cols-[minmax(0,1fr)_25rem] min-[1120px]:grid-rows-[auto_1fr] min-[1120px]:gap-x-10 min-[1120px]:gap-y-6">
      <section className="min-[1120px]:col-start-1 min-[1120px]:row-span-2 min-[1120px]:row-start-1">
        {/* Capped, not stretched. The map is drawn to scale, so a column much
            wider than this makes the frame tall enough to push the question
            off a laptop screen. */}
        <div className="mx-auto w-full max-w-[37.5rem] min-[1120px]:max-w-none">
          <SemanticMap
            lemma={lemma}
            nodes={nodes}
            selectedId={selectedId}
            dimOthers={chosen}
            onSelect={select}
          />
        </div>
        {/* No wrapper: the legend renders nothing when a word has fewer than
            two learning states, and a wrapper would still charge the layout
            its margin for the empty space. */}
        <MapLegend statuses={nodes.map((n) => n.status)} />
      </section>

      {/* The working column. What you are studying now, and the connections you
          can switch to — the same list, put where switching happens rather than
          under a picture it is no longer part of. It also stops the right half
          of a wide screen ending halfway down. */}
      <div className="min-[1120px]:col-start-2 min-[1120px]:row-start-1">
        <Workspace node={selected} onAnswer={handleAnswer} />
      </div>

      <div className="pb-2 min-[1120px]:col-start-2 min-[1120px]:row-start-2">
        <MapOverflow nodes={nodes} selectedId={selectedId} onSelect={select} />
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
