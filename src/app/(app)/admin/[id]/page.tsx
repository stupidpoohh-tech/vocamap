import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { brainMaps } from '@/lib/db/schema'
import { getMasterBrainMap } from '@/lib/data/brain-map'
import { Badge, Card, PageHeader } from '@/components/ui'
import { ReviewActions } from './review-actions'

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireActor()
  if (actor.role === 'student') redirect('/study')

  const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, id)).limit(1)
  if (!head) notFound()

  const map = await getMasterBrainMap(head.vocabularyId, { approvedOnly: false })
  if (!map) notFound()

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

      <ReviewActions brainMapId={map.id} vocabularyId={map.vocabularyId} status={map.status} />

      <div className="mt-8 flex flex-col gap-6">
        <Section title="Meaning Core">
          <p className="font-semibold break-keep">{map.meaningCoreKo ?? '—'}</p>
          {map.meaningCoreEn ? (
            <p className="mt-1 text-sm italic text-muted">{map.meaningCoreEn}</p>
          ) : null}
          <ul className="mt-3 flex flex-col gap-2">
            {map.meanings.map((m) => (
              <li key={m.id} className="rounded-lg bg-line/25 px-3 py-2 text-sm">
                <p className="font-medium">{m.ko}</p>
                {m.connectionNote ? (
                  <p className="mt-1 text-muted break-keep">{m.connectionNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Sentences (${map.sentences.length})`}>
          <ul className="flex flex-col gap-2">
            {map.sentences.map((s) => (
              <li key={s.id} className="rounded-lg bg-line/25 px-3 py-2 text-sm">
                <p>{s.text}</p>
                <p className="mt-1 text-muted">{s.ko}</p>
                <p className="mt-1 text-xs text-muted">
                  용법: {s.targetMeaning ?? '—'} · 난이도 {s.difficulty ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Similar Words (${map.similarWords.length})`}>
          <ul className="flex flex-col gap-2">
            {map.similarWords.map((p) => (
              <li key={p.pairId} className="rounded-lg bg-line/25 px-3 py-2 text-sm">
                <p className="font-semibold">
                  {map.lemma} ↔ {p.otherLemma}
                </p>
                <p className="mt-1 text-muted break-keep">{p.coreDifference}</p>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
                  {p.questions.map((q) => (
                    <li key={q.id}>
                      {q.prompt} → <span className="font-semibold text-ink">{q.answer}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Collocations (${map.collocations.length})`}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {map.collocations.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className="font-mono">{c.expression}</span>
                <span className="text-muted">{c.ko}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Word Family (${map.wordFamily.length})`}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {map.wordFamily.map((f) => (
              <li key={f.id} className="flex justify-between gap-3">
                <span className="font-semibold">
                  {f.lemma} <span className="text-xs font-normal text-muted">{f.partOfSpeech}</span>
                </span>
                <span className="text-muted">{f.ko}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-bold tracking-wide text-brand">{title.toUpperCase()}</h2>
      {children}
    </Card>
  )
}
