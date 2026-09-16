import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import {
  listStudentAccounts,
  listTeacherAccounts,
  listUnansweredLinks,
} from '@/lib/data/teacher'
import { listResettableAccounts } from '@/lib/data/account'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { AccountRow, LinkRow, ResetRow } from './controls'

/**
 * Who may write the public maps, and which students agreed to be followed.
 *
 * This screen exists because the rule it enforces was, for a while, a sentence
 * in a document telling an operator to run SQL. Granting a teacher and settling
 * a link request are both ordinary decisions someone has to make repeatedly;
 * they belong on a page, in front of the person making them.
 *
 * Admins only — not curators. A verified teacher deciding who else is a
 * verified teacher would put the gate back where it started.
 */
export default async function TeacherAdminPage() {
  const actor = await requireActor()
  if (actor.role !== 'admin') redirect('/study')

  const [teachers, students, links, resettable] = await Promise.all([
    listTeacherAccounts(),
    listStudentAccounts(),
    listUnansweredLinks(),
    listResettableAccounts(),
  ])

  const unverified = teachers.filter((t) => !t.verifiedAt)
  const verified = teachers.filter((t) => t.verifiedAt)

  return (
    <div className="animate-rise">
      <PageHeader
        title="계정 관리"
        subtitle="공용 맵을 쓸 수 있는 계정과, 학생이 답하지 않은 연결 요청입니다."
      />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">확인 대기 중인 선생님</h2>
        <p className="mb-3 text-xs text-ink-3 break-keep">
          확인하기 전에는 단어 등록·맵 편집·승인을 할 수 없습니다. 가입 폼으로 역할을 고를 수
          있던 시절에 만들어진 계정도 여기에 있습니다.
        </p>
        {unverified.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft">
              {unverified.map((teacher) => (
                <AccountRow key={teacher.id} account={teacher} action="verify" />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="대기 중인 계정이 없어요" />
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">확인된 선생님</h2>
        <p className="mb-3 text-xs text-ink-3 break-keep">
          권한을 회수해도 계정과 그동안 만든 맵·세트는 그대로 남습니다. 다음 동작부터 막힙니다.
        </p>
        {verified.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft">
              {verified.map((teacher) => (
                <AccountRow key={teacher.id} account={teacher} action="revoke" />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="확인된 선생님이 아직 없어요" />
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">학생을 선생님으로</h2>
        <p className="mb-3 text-xs text-ink-3 break-keep">
          역할을 바꾸고 확인까지 함께 처리합니다. 가입으로는 선생님이 될 수 없습니다.
        </p>
        {students.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft">
              {students.map((student) => (
                <AccountRow key={student.id} account={student} action="grant" />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="학생 계정이 없어요" />
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">답하지 않은 연결 요청</h2>
        <p className="mb-3 text-xs text-ink-3 break-keep">
          학생이 직접 수락하는 것이 정상 경로입니다. 여기서 승인하면 학생이 아니라 관리자가
          동의한 것으로 기록됩니다.
        </p>
        {links.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft">
              {links.map((link) => (
                <LinkRow key={link.id} link={link} />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="기다리는 요청이 없어요" />
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">임시 비밀번호 발급</h2>
        <p className="mb-3 text-xs text-ink-3 break-keep">
          로그인하지 못하는 계정에 한 번 쓸 비밀번호를 만들어 직접 전달해 주세요. 발급하면 원래
          비밀번호는 바로 막히고, 그 계정은 로그인한 모든 기기에서 로그아웃됩니다. 만들어진
          비밀번호는 발급 직후 화면에만 나타납니다. 관리자 계정은 목록에 없습니다.
        </p>
        {resettable.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line-soft">
              {resettable.map((account) => (
                <ResetRow key={account.id} account={account} />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="발급할 계정이 없어요" />
        )}
      </section>
    </div>
  )
}
