'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Input, Textarea } from '@/components/ui'
import { parseWordbook } from '@/lib/import/wordbook'
import { importWordbookPage, type WordbookState } from './actions'

const initial: WordbookState = {}

const PLACEHOLDER = `1. govern
    v. 통치하다, 다스리다; 지배하다

* Whatever we do on earth is governed by the rules of nature.
    = 우리가 지구상에서 하는 모든 것은 자연의 법칙에 의해 지배를 받는다.

* rule / v. 다스리다`

/**
 * Typing a wordbook page in, with the map it will make shown alongside.
 *
 * The preview is the point. One marker in a wordbook carries four different
 * things and the parser decides between them by reading the line, so a teacher
 * has to be able to see that it decided the way they meant — before twenty
 * words are in the library with their collocations filed as synonyms. It is
 * computed in the browser from the same parser the server uses, so it costs
 * nothing and updates as they type.
 *
 * It is a preview, not a submission: the server parses the text again. What is
 * on screen is a courtesy to the person typing, never the source of truth.
 */
export function WordbookForm({
  students,
}: {
  students: Array<{ id: string; displayName: string }>
}) {
  const [text, setText] = useState('')
  const [state, action, pending] = useActionState<WordbookState, FormData>(
    importWordbookPage,
    initial,
  )

  const preview = useMemo(() => (text.trim() ? parseWordbook(text) : null), [text])
  const elapsed = useElapsedSeconds(pending)

  return (
    <Card>
      <form action={action} className="flex flex-col gap-3">
        <Input name="title" placeholder="세트 이름 (예: 16과 시험범위)" required />

        <Textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={12}
          className="font-mono text-sm"
          placeholder={PLACEHOLDER}
          required
        />

        {preview ? <Preview result={preview} /> : <Legend />}

        {students.length > 0 ? (
          <select
            name="studentId"
            defaultValue=""
            className="w-full rounded-card border border-line bg-surface px-4 py-3 text-base"
          >
            <option value="">배정하지 않음</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.displayName}에게 배정
              </option>
            ))}
          </select>
        ) : null}

        <Button disabled={pending || !preview?.entries.length}>
          {pending ? '만드는 중…' : '맵 만들기'}
        </Button>

        {/* A word costs about seventeen round trips to a database that is not
            in this building, and a range is fifty words. Even written eight at
            a time that is seconds, not milliseconds, and a button that only
            says "만드는 중…" for that long is indistinguishable from one that
            has hung. The count says how much work was asked for and the clock
            says it is still being done. */}
        {pending ? (
          <p className="numeral text-center text-xs text-ink-3">
            단어 {preview?.entries.length ?? 0}개를 넣고 있어요 · {elapsed}초
          </p>
        ) : null}
      </form>

      {state.error ? <p className="mt-3 text-sm text-bad break-keep">{state.error}</p> : null}
      {state.message ? (
        <p className="mt-3 text-sm text-good break-keep">{state.message}</p>
      ) : null}
      {state.problems?.length ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {state.problems.map((problem) => (
            <li key={problem} className="text-xs text-warn break-keep">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

/**
 * Seconds since the work started, or 0 when nothing is running.
 *
 * A server action gives the browser no progress to report — the request is
 * open and then it is not — so the one honest thing to show is that time is
 * passing and the page is still waiting. It is the difference between "this is
 * taking a while" and "this is broken".
 */
function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0)
  const startedAt = useRef(0)

  useEffect(() => {
    if (!running) {
      setSeconds(0)
      return
    }
    startedAt.current = Date.now()
    setSeconds(0)
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    )
    return () => clearInterval(timer)
  }, [running])

  return seconds
}

function Legend() {
  return (
    <div className="rounded-card bg-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-2 break-keep">
      <p className="font-medium text-ink">단어장이든 시험 범위 표든 그대로 붙여넣으면 됩니다.</p>
      <p className="mt-1.5">
        단어장은 번호가 단어를 나누고, 뜻은 <code>n. 뜻</code>, 해석은 <code>=</code>, 나머지
        줄은 <code>*</code> 로 시작합니다. 예문·연어·파생어·유의어는 내용을 보고 알아서
        구분합니다.
      </p>
      <p className="mt-1.5">
        <span className="text-ink">어휘 · 영영 풀이 · 의미</span> 로 된 표도 그대로 됩니다.
        열 순서와 번호는 상관없고, 표 제목 줄과 페이지 표시는 알아서 건너뜁니다. 예문이
        없어도 영영 풀이가 문제가 됩니다.
      </p>
      <p className="mt-1.5">
        <span className="text-ink">영영 풀이 해석</span> 열을 하나 더 넣으면, 맵에서 영어
        풀이를 읽고 눌러서 그 해석을 확인할 수 있어요. 한국어 열이 둘이 되므로 이때는 표
        제목 줄이 있어야 합니다.
      </p>
      <p className="mt-1.5">읽은 결과는 저장 전에 아래에서 보여줍니다.</p>
    </div>
  )
}

function Preview({ result }: { result: ReturnType<typeof parseWordbook> }) {
  const { entries, problems } = result
  const rivalDefinitions =
    entries.filter((entry) => entry.senses.some((sense) => sense.enDefinition)).length >= 2

  return (
    <div className="rounded-card bg-sunken px-3.5 py-3">
      <p className="text-xs text-ink-2">
        <span className="numeral font-medium text-ink">{entries.length}</span>개 단어를 읽었어요
        {problems.length ? (
          <span className="text-warn"> · 못 읽은 줄 {problems.length}개</span>
        ) : null}
      </p>

      {problems.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
          {problems.slice(0, 6).map((problem) => (
            <li key={`${problem.line}`} className="text-xs text-warn break-keep">
              {problem.line}행: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}

      {entries.length ? (
        <ul className="mt-2 max-h-64 divide-y divide-line-soft overflow-y-auto overscroll-contain border-t border-line">
          {entries.map((entry) => {
            const examples = entry.senses.reduce((n, sense) => n + sense.examples.length, 0)
            const definitions = entry.senses.filter((sense) => sense.enDefinition).length
            // A definition question is told apart from the definitions of the
            // other words in the paste, so one word alone cannot be asked that
            // way — which makes this a fact about the paste, not the word.
            const askable =
              examples > 0 ||
              (definitions > 0 && rivalDefinitions) ||
              entry.collocations.length >= 2 ||
              entry.wordFamily.length >= 2
            return (
              <li key={`${entry.line}-${entry.lemma}`} className="py-2">
                <p className="text-[0.9375rem] text-ink">{entry.lemma}</p>
                {/* Counts, in the order the map builds them. Reading "연어 0"
                    where six were typed is how a mis-sorted line is caught, and
                    reading "영영 1" is how a table of definitions is confirmed
                    to have been understood as one. */}
                <p className="numeral mt-0.5 text-[0.6875rem] text-ink-3">
                  뜻 {entry.senses.length} · 영영 {definitions} · 예문 {examples} · 연어{' '}
                  {entry.collocations.length} · 파생어 {entry.wordFamily.length}
                  {entry.synonyms.length ? (
                    <span className="text-ink-3"> · 유의어 {entry.synonyms.length}(미사용)</span>
                  ) : null}
                  {/* Only when there is genuinely nothing to ask. Warning on a
                      missing example was right when sentences were the only
                      material; on a range of definitions it flagged all fifty
                      words that were about to work perfectly well. */}
                  {askable ? null : <span className="text-warn"> · 낼 문제 없음</span>}
                </p>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
