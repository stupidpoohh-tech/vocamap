'use client'

import { useEffect, useState } from 'react'
import { MapLegend, MapOverflow, SemanticMap } from '@/components/brain-map/semantic-map'
import { Workspace, type WorkspaceAnswer } from '@/components/brain-map/workspace'
import type { SemanticNode } from '@/lib/data/semantic-map'
import { answerNode, openBrainMap, revealNode } from './actions'

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
  recordOpen,
}: {
  vocabularyId: string
  lemma: string
  nodes: SemanticNode[]
  recommendedNodeId: string | null
  /**
   * Whether this visit is worth writing down. Decided on the server, where the
   * two timestamps that answer it already are.
   */
  recordOpen: boolean
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

  // Opening the map is what settles a recommendation, so this has to fire
  // whenever there is a recommendation it could settle — not only on the very
  // first visit.
  //
  // It used to skip every visit after the first, while the recommendation was
  // only considered answered by an open *later than* the recommendation. A
  // student who had read a word's map and then started getting it wrong was
  // recommended that map and could never clear it: reopening wrote nothing, so
  // the word sat in 추천 for good. Now the server says whether this visit tells
  // us anything, and a visit that does not still costs no round trip.
  useEffect(() => {
    if (!recordOpen) return
    void openBrainMap(vocabularyId)
  }, [recordOpen, vocabularyId])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const handleAnswer: WorkspaceAnswer = (outcome) => {
    // Reading a translation is not answering a question about it. It used to
    // be sent as a correct answer, which moved the node towards mastered and
    // counted towards the reader's accuracy for pressing the only button on
    // the card. It is recorded as what it is, and changes no status.
    if (outcome.kind === 'revealed') {
      void revealNode({
        vocabularyId,
        node: outcome.node.progressNode,
        payload: outcome.payload,
      })
      return
    }

    // Reflect the node's new state straight away, then persist.
    void answerNode({
      vocabularyId,
      node: outcome.node.progressNode,
      questionType: questionTypeFor(outcome.node.kind),
      correct: outcome.correct,
      responseTimeMs: outcome.responseTimeMs,
      payload: outcome.payload,
    }).then(() => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === outcome.node.id
            ? { ...n, status: outcome.correct ? 'learning' : 'weak' }
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
    case 'collocation':
      return 'collocation_cloze' as const
    case 'wordFamily':
      return 'word_family_cloze' as const
    default:
      return 'sentence_translation' as const
  }
}
