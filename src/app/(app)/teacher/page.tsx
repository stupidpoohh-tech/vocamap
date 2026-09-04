import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { listSets, listStudents } from '@/lib/data/teacher'
import { DeleteSetButton } from '@/components/words/delete-set-button'
import { WordbookForm } from './wordbook-form'
import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { AddStudentForm, ImportWordsForm } from './forms'

export default async function TeacherPage() {
  const actor = await requireActor()
  if (actor.role === 'student') redirect('/study')

  const [students, sets] = await Promise.all([listStudents(actor.id), listSets(actor.id)])

  return (
    <div className="animate-rise">
      <PageHeader title="교사" subtitle="학생과 단어 세트를 관리합니다." />

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">학생 {students.length}명</h2>
        {students.length === 0 ? (
          <EmptyState
            title="아직 학생이 없어요"
            hint="학생이 회원가입한 뒤, 그 이메일로 아래에서 추가하세요."
          />
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {students.map((student) => (
              <li key={student.id}>
                <Link
                  href={`/teacher/students/${student.id}`}
                  className="card flex items-center justify-between px-5 py-4 transition hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{student.displayName}</p>
                    <p className="truncate text-sm text-ink-3">{student.email}</p>
                  </div>
                  <span className="text-sm text-brand">보기 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <AddStudentForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">단어 세트</h2>
        {sets.length === 0 ? (
          <EmptyState title="아직 세트가 없어요" hint="아래에서 단어 목록을 붙여넣어 만들 수 있어요." />
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {sets.map((set) => (
              <li key={set.id}>
                {/* Opens the word list filtered to this set — the way into a
                    word, and from there into its Brain Map. */}
                <Link
                  href={`/study?set=${set.id}`}
                  className="card flex items-center justify-between gap-4 px-5 py-4 transition hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{set.title}</p>
                    {set.description ? (
                      <p className="truncate text-sm text-ink-3">{set.description}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {set.isSeed ? <Badge>예시</Badge> : null}
                    <Badge tone="brand">{set.wordCount}개</Badge>
                    <DeleteSetButton setId={set.id} title={set.title} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">단어장에서 맵 만들기</h2>
        <p className="mb-3 text-sm text-ink-3 break-keep">
          단어장 페이지를 그대로 옮겨 적으면 뜻·예문·연어·파생어까지 담긴 Brain Map이
          바로 만들어져요. AI를 쓰지 않으니 검수도 필요 없습니다.
        </p>
        <WordbookForm students={students} />
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">단어만 가져오기</h2>
        <p className="mb-3 text-sm text-ink-3 break-keep">
          단어와 뜻만 있는 목록이면 이쪽이 빠릅니다. 맵은 나중에 따로 만들어요.
        </p>
        <ImportWordsForm students={students} />
      </section>
    </div>
  )
}
