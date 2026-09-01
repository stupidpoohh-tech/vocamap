'use client'

import { useEffect, useState } from 'react'
import { MapLegend, RadialMap, type MapNode } from '@/components/brain-map/radial-map'
import {
  CollocationsPanel,
  MeaningCorePanel,
  SentencesPanel,
  SimilarWordsPanel,
  WordFamilyPanel,
  type NodeAnswerHandler,
} from '@/components/brain-map/node-panels'
import { NODE_LABEL, type NodeType } from '@/lib/learning/nodes'
import type { MasterBrainMap } from '@/lib/data/brain-map'
import { answerNode, openBrainMap } from './actions'

export function BrainMapExplorer({
  master,
  nodes,
  vocabularyId,
  suggestedNodes,
}: {
  master: MasterBrainMap
  nodes: MapNode[]
  vocabularyId: string
  suggestedNodes: NodeType[]
}) {
  const [active, setActive] = useState<NodeType | null>(null)
  const [liveNodes, setLiveNodes] = useState(nodes)

  // Opening the map is itself a signal — it tells us the recommendation landed.
  useEffect(() => {
    void openBrainMap(vocabularyId)
  }, [vocabularyId])

  const firstSuggestion = suggestedNodes.find(
    (n) => liveNodes.find((l) => l.node === n)?.status !== 'locked',
  )

  const handleAnswer: NodeAnswerHandler = (input) => {
    // Reflect the node's new state immediately, then persist.
    void answerNode({ vocabularyId, ...input }).then((result) => {
      setLiveNodes((prev) =>
        prev.map((n) =>
          n.node === input.node ? { ...n, status: result.nodeStatus as MapNode['status'] } : n,
        ),
      )
    })
  }

  return (
    <section className="mt-8">
      <RadialMap
        lemma={master.lemma}
        nodes={liveNodes}
        activeNode={active}
        onSelect={(node) => setActive((current) => (current === node ? null : node))}
      />

      <div className="mt-2">
        <MapLegend />
      </div>

      {active === null ? (
        <p className="mt-6 text-center text-sm text-muted">
          {firstSuggestion ? (
            <>
              <span className="font-medium text-ink">{NODE_LABEL[firstSuggestion]}</span>
              부터 열어보는 걸 추천해요.
            </>
          ) : (
            '노드를 눌러 학습을 시작하세요.'
          )}
        </p>
      ) : (
        <div className="mt-6 animate-rise">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">{NODE_LABEL[active]}</h2>
            <button
              onClick={() => setActive(null)}
              className="text-sm text-muted hover:text-ink"
              aria-label="닫기"
            >
              닫기 ✕
            </button>
          </div>
          <NodeContent node={active} master={master} onAnswer={handleAnswer} />
        </div>
      )}
    </section>
  )
}

function NodeContent({
  node,
  master,
  onAnswer,
}: {
  node: NodeType
  master: MasterBrainMap
  onAnswer: NodeAnswerHandler
}) {
  switch (node) {
    case 'meaning_core':
      return <MeaningCorePanel map={master} />
    case 'sentences':
      return <SentencesPanel map={master} onAnswer={onAnswer} />
    case 'similar_words':
      return <SimilarWordsPanel map={master} onAnswer={onAnswer} />
    case 'collocations':
      return <CollocationsPanel map={master} onAnswer={onAnswer} />
    case 'word_family':
      return <WordFamilyPanel map={master} onAnswer={onAnswer} />
  }
}
