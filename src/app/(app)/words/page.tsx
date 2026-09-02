import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { assignments, vocabularySetItems, vocabularySets } from '@/lib/db/schema'
import {
  brainMapStates,
  listLibraryWords,
  listVocabularySummaries,
  searchVocabulary,
  type BrainMapState,
  type LibraryWord,
} from '@/lib/data/vocabulary'
import { Badge, EmptyState, Input, PageHeader } from '@/components/ui'

/**
 * Two audiences, two lists.
 *
 * A student sees the words assigned to them. A teacher is assigned nothing, so
 * they see the shared library with the state of each word's Brain Map — this is
 * their route into a word, and the only place Brain Maps get made.
 */
export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string }>
}) {
  const { q, set } = await searchParams
  const actor = await requireActor()
  const query = q?.trim() ?? ''
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'

  const setName = set ? await lookupSetName(set) : null
  const words = await loadWords({ actor, query, setId: set, isCurator })

  return (
    <div className="animate-rise">
      <PageHeader
        title="단어"
        subtitle={
          query
            ? `"${query}" 검색 결과`
            : setName
              ? `세트 · ${setName}`
              : isCurator
                ? '단어를 눌러 Brain Map을 만들거나 확인하세요'
                : '나에게 배정된 단어'
        }
      />

      <form action="/words" className="mb-5">
        {set ? <input type="hidden" name="set" value={set} /> : null}
        <Input
          name="q"
          defaultValue={query}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          aria-label="단어 검색"
        />
      </form>

      {isCurator && !query ? <Legend /> : null}

      {words.length === 0 ? (
        <EmptyState
          title={query ? '검색 결과가 없어요' : isCurator ? '아직 단어가 없어요' : '배정된 단어가 없어요'}
          hint={
            query
              ? '다른 표현으로 찾아보세요.'
              : isCurator
                ? '교사 탭의 "단어 가져오기"로 단어를 등록하면 여기에 나타나요.'
                : '선생님이 단어 세트를 배정하면 여기에 나타나요.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((word) => (
            <li key={word.id}>
              <Link
                href={`/words/${word.id}`}
                className="card flex items-center justify-between gap-3 px-5 py-4 transition hover:border-brand"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{word.lemma}</p>
                  <p className="truncate text-sm text-muted">{word.translation ?? '—'}</p>
                </div>
                {isCurator ? (
                  <MapBadge state={word.brainMapStatus} />
                ) : (
                  <span className="shrink-0 text-xs text-muted">
                    {word.partOfSpeech ?? ''} {word.level ?? ''}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {set ? (
        <Link href="/words" className="mt-5 inline-block text-sm text-muted hover:text-ink">
          ← 전체 단어 보기
        </Link>
      ) : null}
    </div>
  )
}

const BADGE: Record<BrainMapState, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  none: { label: 'Brain Map 없음', tone: 'neutral' },
  draft: { label: '검수 대기', tone: 'warn' },
  approved: { label: '공개됨', tone: 'good' },
}

function MapBadge({ state }: { state: BrainMapState }) {
  const { label, tone } = BADGE[state]
  return (
    <Badge tone={tone} className="shrink-0">
      {label}
    </Badge>
  )
}

function Legend() {
  return (
    <p className="mb-4 text-xs text-muted break-keep">
      <span className="font-medium text-ink">Brain Map 없음</span> 인 단어를 누르면 AI 초안을
      만들 수 있어요. 만든 뒤 <span className="font-medium text-ink">검수</span> 탭에서 승인해야
      학생에게 보입니다.
    </p>
  )
}

async function loadWords(input: {
  actor: { id: string; role: string }
  query: string
  setId?: string
  isCurator: boolean
}): Promise<LibraryWord[]> {
  if (input.query) {
    const found = await searchVocabulary(input.query, 40)
    if (!input.isCurator) return found.map((w) => ({ ...w, brainMapStatus: 'none' as const }))
    const states = await brainMapStates(found.map((w) => w.id))
    return found.map((w) => ({ ...w, brainMapStatus: states.get(w.id) ?? 'none' }))
  }

  if (input.isCurator) return listLibraryWords({ setId: input.setId })

  const assigned = await db
    .selectDistinct({ id: vocabularySetItems.vocabularyId })
    .from(assignments)
    .innerJoin(vocabularySetItems, eq(vocabularySetItems.setId, assignments.setId))
    .where(eq(assignments.studentId, input.actor.id))

  const summaries = await listVocabularySummaries(assigned.map((row) => row.id))
  return summaries.map((w) => ({ ...w, brainMapStatus: 'none' as const }))
}

async function lookupSetName(setId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: vocabularySets.title })
    .from(vocabularySets)
    .where(eq(vocabularySets.id, setId))
    .limit(1)
  return row?.title ?? null
}
