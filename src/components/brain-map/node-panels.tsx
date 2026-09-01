'use client'

import { useState } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import type { MasterBrainMap } from '@/lib/data/brain-map'
import type { NodeType } from '@/lib/learning/nodes'

export type NodeAnswerHandler = (input: {
  node: NodeType
  questionType: 'sentence_translation' | 'similar_battle' | 'collocation_cloze' | 'word_family_cloze'
  correct: boolean
  responseTimeMs: number
  pairId?: string
  payload?: Record<string, unknown>
}) => void

/* ───────────────────────────── Meaning Core ───────────────────────────── */

/**
 * Not a list of dictionary glosses. The core idea sits on top, and each sense
 * is shown as a branch off it with an explicit note on how it follows — that
 * connection is the thing worth learning.
 */
export function MeaningCorePanel({ map }: { map: MasterBrainMap }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand/30 bg-brand-soft/40">
        <p className="text-xs font-semibold tracking-wide text-brand">MEANING CORE</p>
        <p className="mt-2 text-lg font-bold leading-snug break-keep">{map.meaningCoreKo}</p>
        {map.meaningCoreEn ? (
          <p className="mt-1.5 text-sm italic text-muted">{map.meaningCoreEn}</p>
        ) : null}
      </Card>

      <ul className="flex flex-col gap-2.5">
        {map.meanings.map((meaning, i) => (
          <li key={meaning.id} className="card p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold tabular-nums text-brand">{i + 1}</span>
              <p className="font-semibold break-keep">{meaning.ko}</p>
            </div>
            {meaning.exampleChunk ? (
              <p className="mt-1.5 font-mono text-sm text-muted">{meaning.exampleChunk}</p>
            ) : null}
            {meaning.connectionNote ? (
              <p className="mt-2.5 border-l-2 border-brand/30 pl-3 text-sm leading-relaxed text-muted break-keep">
                {meaning.connectionNote}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ────────────────────────── Multiple Sentences ────────────────────────── */

/**
 * The student translates first, then reveals. Reading a sentence with its
 * translation already visible teaches nothing; committing to an attempt before
 * seeing the answer is the whole exercise.
 */
export function SentencesPanel({
  map,
  onAnswer,
}: {
  map: MasterBrainMap
  onAnswer: NodeAnswerHandler
}) {
  return (
    <ul className="flex flex-col gap-3">
      {map.sentences.map((sentence) => (
        <SentenceCard key={sentence.id} sentence={sentence} onAnswer={onAnswer} />
      ))}
    </ul>
  )
}

function SentenceCard({
  sentence,
  onAnswer,
}: {
  sentence: MasterBrainMap['sentences'][number]
  onAnswer: NodeAnswerHandler
}) {
  const [revealed, setRevealed] = useState(false)
  const [attempt, setAttempt] = useState('')
  const [startedAt] = useState(() => Date.now())
  const [graded, setGraded] = useState<boolean | null>(null)

  return (
    <li className="card p-4">
      <p className="text-lg leading-relaxed">{highlight(sentence.text, sentence.highlight)}</p>

      {!revealed ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            placeholder="직접 해석해 보세요"
            rows={2}
            className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <Button variant="secondary" onClick={() => setRevealed(true)}>
            해석 확인
          </Button>
        </div>
      ) : (
        <div className="mt-3 animate-rise">
          <p className="rounded-lg bg-line/30 px-3 py-2.5 text-sm break-keep">{sentence.ko}</p>
          {sentence.targetMeaning ? (
            <p className="mt-2 text-xs text-muted">
              이 문장에서의 쓰임 · <span className="text-ink">{sentence.targetMeaning}</span>
            </p>
          ) : null}

          {graded === null ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted">내 해석과 비교했을 때 어땠나요?</p>
              <div className="flex gap-2">
                {[
                  { label: '맞았어요', correct: true },
                  { label: '틀렸어요', correct: false },
                ].map((option) => (
                  <Button
                    key={option.label}
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setGraded(option.correct)
                      onAnswer({
                        node: 'sentences',
                        questionType: 'sentence_translation',
                        correct: option.correct,
                        responseTimeMs: Date.now() - startedAt,
                        payload: { sentenceId: sentence.id, attempt },
                      })
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Badge tone={graded ? 'good' : 'bad'} className="mt-3">
              {graded ? '이해 완료' : '다시 볼 문장'}
            </Badge>
          )}
        </div>
      )}
    </li>
  )
}

function highlight(text: string, target: string | null) {
  if (!target) return text
  const index = text.toLowerCase().indexOf(target.toLowerCase())
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-brand-soft px-0.5 font-semibold text-brand">
        {text.slice(index, index + target.length)}
      </mark>
      {text.slice(index + target.length)}
    </>
  )
}

/* ─────────────────────────── Similar Words ─────────────────────────── */

/** A drill on the difference, not a synonym list. */
export function SimilarWordsPanel({
  map,
  onAnswer,
}: {
  map: MasterBrainMap
  onAnswer: NodeAnswerHandler
}) {
  return (
    <div className="flex flex-col gap-4">
      {map.similarWords.map((pair) => (
        <BattleCard key={pair.pairId} pair={pair} lemma={map.lemma} onAnswer={onAnswer} />
      ))}
    </div>
  )
}

function BattleCard({
  pair,
  lemma,
  onAnswer,
}: {
  pair: MasterBrainMap['similarWords'][number]
  lemma: string
  onAnswer: NodeAnswerHandler
}) {
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const question = pair.questions[step]
  const options = [lemma, pair.otherLemma]

  return (
    <Card>
      <div className="flex items-center justify-center gap-3 text-lg font-bold">
        <span className="text-brand">{lemma}</span>
        <span className="text-xs font-medium text-muted">vs</span>
        <span>{pair.otherLemma}</span>
      </div>

      <p className="mt-3 rounded-lg bg-line/30 px-3 py-2.5 text-sm leading-relaxed break-keep">
        {pair.coreDifference}
      </p>
      {pair.usageRule ? (
        <p className="mt-2 text-xs text-muted break-keep">💡 {pair.usageRule}</p>
      ) : null}

      {question ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-1 text-xs text-muted">
            {step + 1} / {pair.questions.length}
          </p>
          <p className="text-base leading-relaxed">{question.prompt}</p>

          <div className="mt-3 flex gap-2">
            {options.map((option) => {
              const isAnswer = option.toLowerCase() === question.answer.toLowerCase()
              const picked = chosen === option
              return (
                <Button
                  key={option}
                  variant="secondary"
                  disabled={chosen !== null}
                  className={`flex-1 ${
                    chosen && isAnswer
                      ? 'border-good bg-good-soft text-good'
                      : picked
                        ? 'border-bad bg-bad-soft text-bad'
                        : ''
                  }`}
                  onClick={() => {
                    setChosen(option)
                    onAnswer({
                      node: 'similar_words',
                      questionType: 'similar_battle',
                      correct: isAnswer,
                      responseTimeMs: Date.now() - startedAt,
                      pairId: pair.pairId,
                      payload: { prompt: question.prompt, choice: option },
                    })
                  }}
                >
                  {option}
                </Button>
              )
            })}
          </div>

          {chosen ? (
            <div className="mt-3 animate-rise">
              <p className="text-sm leading-relaxed text-muted break-keep">{question.explanation}</p>
              {step + 1 < pair.questions.length ? (
                <Button
                  className="mt-3 w-full"
                  onClick={() => {
                    setStep((s) => s + 1)
                    setChosen(null)
                    setStartedAt(Date.now())
                  }}
                >
                  다음 문제
                </Button>
              ) : (
                <Badge tone="brand" className="mt-3">
                  이 짝 학습 완료
                </Badge>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

/* ─────────────────────────── Collocations ─────────────────────────── */

export function CollocationsPanel({
  map,
  onAnswer,
}: {
  map: MasterBrainMap
  onAnswer: NodeAnswerHandler
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  return (
    <ul className="flex flex-col gap-2.5">
      {map.collocations.map((c) => {
        const isRevealed = revealed.has(c.id)
        return (
          <li key={c.id} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-base font-semibold">{c.expression}</p>
              {c.importance === 1 ? <Badge tone="brand">필수</Badge> : null}
            </div>

            {isRevealed ? (
              <div className="mt-2 animate-rise">
                <p className="text-sm">{c.ko}</p>
                {c.exampleSentence ? (
                  <p className="mt-1.5 text-sm text-muted">{c.exampleSentence}</p>
                ) : null}
              </div>
            ) : (
              <Button
                variant="ghost"
                className="mt-2 px-0"
                onClick={() => {
                  setRevealed((prev) => new Set(prev).add(c.id))
                  onAnswer({
                    node: 'collocations',
                    questionType: 'collocation_cloze',
                    // Revealing without guessing is not evidence of knowing it.
                    correct: false,
                    responseTimeMs: 0,
                    payload: { collocationId: c.id, revealed: true },
                  })
                }}
              >
                뜻 확인하기 →
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ─────────────────────────── Word Family ─────────────────────────── */

/**
 * Derivatives become a form-choice question, because the actual exam skill is
 * picking the right form for the slot, not reciting the family.
 */
export function WordFamilyPanel({
  map,
  onAnswer,
}: {
  map: MasterBrainMap
  onAnswer: NodeAnswerHandler
}) {
  const forms = [map.lemma, ...map.wordFamily.map((f) => f.lemma)]
  const quizItem = map.wordFamily.find((f) => f.exampleSentence)

  const [chosen, setChosen] = useState<string | null>(null)
  const [startedAt] = useState(() => Date.now())

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {[
          { lemma: map.lemma, partOfSpeech: map.partOfSpeech ?? '', ko: '', isRoot: true },
          ...map.wordFamily.map((f) => ({ ...f, isRoot: false })),
        ].map((f) => (
          <li
            key={f.lemma}
            className={`card flex items-baseline gap-3 px-4 py-3 ${
              f.isRoot ? 'border-brand/40 bg-brand-soft/30' : ''
            }`}
          >
            <span className={`font-semibold ${f.isRoot ? 'text-brand' : ''}`}>{f.lemma}</span>
            {f.partOfSpeech ? (
              <span className="text-xs text-muted">{f.partOfSpeech}</span>
            ) : null}
            {f.ko ? <span className="ml-auto text-sm text-muted">{f.ko}</span> : null}
          </li>
        ))}
      </ul>

      {quizItem?.exampleSentence && forms.length > 1 ? (
        <Card>
          <p className="mb-3 text-xs font-semibold tracking-wide text-brand">FORM CHECK</p>
          <p className="text-base leading-relaxed">
            {quizItem.exampleSentence.replace(
              new RegExp(quizItem.lemma, 'i'),
              '______',
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {forms.map((form) => {
              const isAnswer = form.toLowerCase() === quizItem.lemma.toLowerCase()
              const picked = chosen === form
              return (
                <Button
                  key={form}
                  variant="secondary"
                  disabled={chosen !== null}
                  className={
                    chosen && isAnswer
                      ? 'border-good bg-good-soft text-good'
                      : picked
                        ? 'border-bad bg-bad-soft text-bad'
                        : ''
                  }
                  onClick={() => {
                    setChosen(form)
                    onAnswer({
                      node: 'word_family',
                      questionType: 'word_family_cloze',
                      correct: isAnswer,
                      responseTimeMs: Date.now() - startedAt,
                      payload: { answer: quizItem.lemma, choice: form },
                    })
                  }}
                >
                  {form}
                </Button>
              )
            })}
          </div>
          {chosen ? (
            <p className="mt-3 animate-rise text-sm text-muted">
              정답은 <span className="font-semibold text-ink">{quizItem.lemma}</span> ·{' '}
              {quizItem.ko}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
