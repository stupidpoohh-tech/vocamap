import Link from 'next/link'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { assignments, vocabularySetItems } from '@/lib/db/schema'
import { listVocabularySummaries, searchVocabulary } from '@/lib/data/vocabulary'
import { EmptyState, Input, PageHeader } from '@/components/ui'

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const actor = await requireActor()
  const query = q?.trim() ?? ''

  const words = query
    ? await searchVocabulary(query, 40)
    : await listAssignedWords(actor.id)

  return (
    <div className="animate-rise">
      <PageHeader
        title="단어"
        subtitle={query ? `"${query}" 검색 결과` : '나에게 배정된 단어'}
      />

      <form action="/words" className="mb-5">
        <Input
          name="q"
          defaultValue={query}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          aria-label="단어 검색"
        />
      </form>

      {words.length === 0 ? (
        <EmptyState
          title={query ? '검색 결과가 없어요' : '배정된 단어가 없어요'}
          hint={query ? '다른 표현으로 찾아보세요.' : '선생님이 단어 세트를 배정하면 여기에 나타나요.'}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((word) => (
            <li key={word.id}>
              <Link
                href={`/words/${word.id}`}
                className="card flex items-center justify-between gap-4 px-5 py-4 transition hover:border-brand"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{word.lemma}</p>
                  <p className="truncate text-sm text-muted">{word.translation ?? '—'}</p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {word.partOfSpeech ?? ''} {word.level ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function listAssignedWords(userId: string) {
  const rows = await db
    .selectDistinct({ id: vocabularySetItems.vocabularyId })
    .from(assignments)
    .innerJoin(vocabularySetItems, eq(vocabularySetItems.setId, assignments.setId))
    .where(eq(assignments.studentId, userId))
  return listVocabularySummaries(rows.map((r) => r.id))
}
