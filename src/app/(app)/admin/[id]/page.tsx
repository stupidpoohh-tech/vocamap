import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { brainMaps } from '@/lib/db/schema'
import { getMasterBrainMap, type MasterBrainMap } from '@/lib/data/brain-map'
import { Badge, PageHeader } from '@/components/ui'
import { ReviewActions } from './review-actions'
import { CoreEditor } from './core-editor'
import { ItemSection, type EditableItem } from './item-editor'

/**
 * The review screen, which is also the edit screen.
 *
 * A draft is usually right about most of itself and wrong about one row, so the
 * two old buttons — approve everything, regenerate everything — were both the
 * wrong size. Every item here can be edited or deleted on its own, and new ones
 * can be written by hand, so a curator fixes what is wrong and keeps what works
 * instead of paying for another generation and hoping.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireActor()
  if (actor.role === 'student') redirect('/study')

  const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, id)).limit(1)
  if (!head) notFound()

  const map = await getMasterBrainMap(head.vocabularyId, { approvedOnly: false })
  if (!map) notFound()

  const common = { brainMapId: map.id, vocabularyId: map.vocabularyId }

  return (
    <div className="animate-rise">
      <Link href="/admin" className="text-sm text-muted hover:text-ink">
        ← 검수
      </Link>
      <PageHeader
        title={map.lemma}
        subtitle={`v${map.version} · ${head.generatedByModel ?? '수기 작성'} · ${head.promptVersion ?? '—'}`}
        action={<Badge tone={map.status === 'approved' ? 'good' : 'warn'}>{map.status}</Badge>}
      />

      {head.reviewNote ? (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-warn">확인이 필요한 점</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {head.reviewNote.split('\n').filter(Boolean).map((note) => (
              <li key={note} className="text-sm leading-relaxed text-warn break-keep">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ReviewActions brainMapId={map.id} vocabularyId={map.vocabularyId} status={map.status} />

      {map.status === 'approved' ? (
        <p className="mt-3 rounded-xl bg-line/30 px-4 py-2.5 text-xs text-muted break-keep">
          이미 공개된 맵이에요. 여기서 고치면 학생 화면에 바로 반영돼요.
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-6">
        <CoreEditor {...common} ko={map.meaningCoreKo} en={map.meaningCoreEn} />

        <ItemSection
          {...common}
          kind="meaning"
          title="뜻 / 용법"
          items={meaningItems(map)}
        />

        <ItemSection
          {...common}
          kind="sentence"
          title="예문"
          items={sentenceItems(map)}
        />

        <ItemSection
          {...common}
          kind="collocation"
          title="함께 쓰는 표현"
          items={collocationItems(map)}
        />

        <ItemSection
          {...common}
          kind="wordFamily"
          title="파생어"
          items={familyItems(map)}
        />

        <ItemSection
          {...common}
          kind="pair"
          title="헷갈리는 단어"
          note="이 설명은 두 단어의 맵에서 함께 쓰여요. 삭제하면 이 단어의 맵에서만 빠지고, 다른 단어의 맵에는 그대로 남아요."
          items={pairItems(map, common)}
        />
      </div>
    </div>
  )
}

/* The summaries below are what a curator scans, so each one leads with the
   thing they are checking rather than with a field name. */

function meaningItems(map: MasterBrainMap): EditableItem[] {
  return map.meanings.map((m) => ({
    id: m.id,
    values: {
      ko: m.ko,
      enDefinition: m.enDefinition ?? '',
      connectionNote: m.connectionNote ?? '',
      exampleChunk: m.exampleChunk ?? '',
    },
    summary: (
      <>
        <p className="font-medium break-keep">{m.ko}</p>
        {m.connectionNote ? (
          <p className="mt-1 text-muted break-keep">{m.connectionNote}</p>
        ) : null}
        {m.exampleChunk ? (
          <p className="mt-1 font-mono text-xs text-muted">{m.exampleChunk}</p>
        ) : null}
      </>
    ),
  }))
}

function sentenceItems(map: MasterBrainMap): EditableItem[] {
  return map.sentences.map((s) => ({
    id: s.id,
    values: {
      text: s.text,
      ko: s.ko,
      targetMeaning: s.targetMeaning ?? '',
      highlight: s.highlight ?? '',
      difficulty: s.difficulty === null ? '' : String(s.difficulty),
    },
    summary: (
      <>
        <p className="break-keep">{s.text}</p>
        <p className="mt-1 text-muted break-keep">{s.ko}</p>
        <p className="mt-1 text-xs text-muted">
          용법: {s.targetMeaning ?? '—'} · 난이도 {s.difficulty ?? '—'}
          {s.highlight ? ` · 강조 "${s.highlight}"` : ''}
        </p>
      </>
    ),
  }))
}

function collocationItems(map: MasterBrainMap): EditableItem[] {
  return map.collocations.map((c) => ({
    id: c.id,
    values: {
      expression: c.expression,
      ko: c.ko,
      exampleSentence: c.exampleSentence ?? '',
      importance: String(c.importance),
    },
    summary: (
      <>
        <p>
          <span className="font-mono font-medium">{c.expression}</span>
          <span className="ml-2 text-muted">{c.ko}</span>
        </p>
        {c.exampleSentence ? (
          <p className="mt-1 text-xs text-muted break-keep">{c.exampleSentence}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted">중요도 {c.importance}</p>
      </>
    ),
  }))
}

function familyItems(map: MasterBrainMap): EditableItem[] {
  return map.wordFamily.map((f) => ({
    id: f.id,
    values: {
      lemma: f.lemma,
      partOfSpeech: f.partOfSpeech,
      ko: f.ko,
      exampleSentence: f.exampleSentence ?? '',
    },
    summary: (
      <>
        <p>
          <span className="font-medium">{f.lemma}</span>
          <span className="ml-2 text-xs text-muted">{f.partOfSpeech}</span>
          <span className="ml-2 text-muted">{f.ko}</span>
        </p>
        {f.exampleSentence ? (
          <p className="mt-1 text-xs text-muted break-keep">{f.exampleSentence}</p>
        ) : null}
      </>
    ),
  }))
}

function pairItems(
  map: MasterBrainMap,
  common: { brainMapId: string; vocabularyId: string },
): EditableItem[] {
  return map.similarWords.map((p) => ({
    id: p.pairId,
    values: {
      lemma: p.otherLemma,
      coreDifference: p.coreDifference,
      usageRule: p.usageRule ?? '',
    },
    summary: (
      <>
        <p className="font-semibold">
          {map.lemma} ↔ {p.otherLemma}
        </p>
        <p className="mt-1 text-muted break-keep">{p.coreDifference}</p>
        {p.usageRule ? <p className="mt-1 text-xs text-muted break-keep">{p.usageRule}</p> : null}
      </>
    ),
    // The battle questions belong to the pair, so they are edited inside it.
    children: (
      <ItemSection
        {...common}
        kind="pairQuestion"
        parentId={p.pairId}
        title="구별 문제"
        addLabel="+ 문제 추가"
        dense
        items={p.questions.map((q) => ({
          id: q.id,
          values: { prompt: q.prompt, answer: q.answer, explanation: q.explanation },
          summary: (
            <>
              <p className="break-keep">
                {q.prompt} → <span className="font-semibold">{q.answer}</span>
              </p>
              <p className="mt-1 text-xs text-muted break-keep">{q.explanation}</p>
            </>
          ),
        }))}
      />
    ),
  }))
}
