# 운영 절차 — 권한 확인과 배포 순서

이 문서는 `0004_consent_and_verification` 마이그레이션과 함께 나가는 변경에
대해, 운영자가 **배포 전후로 반드시 해야 하는 일**을 적는다.

이 변경은 데이터를 지우지 않는다. 계정, 교사-학생 연결, 맵, 학습 기록은
전부 그대로 남는다. 바뀌는 것은 **무엇을 권한으로 인정하는가**이다.
스스로 주장한 것으로 통과되던 두 가지가 이제 누가 확인했다는 근거를
요구한다.

---

## 1. 무엇이 잠기는가

배포 직후, 다음 두 가지가 **동작을 멈춘다**. 의도된 것이고, 아래 절차로
푼다.

| 대상 | 배포 직후 상태 | 푸는 방법 |
| --- | --- | --- |
| 기존 `teacher` 계정 전부 | 보호된 교사 기능 사용 불가 | 관리자가 계정별로 확인 (2절) |
| 기존 `active` 교사-학생 연결 전부 | `pending`으로 되돌아감 | 학생 본인이 수락, 또는 관리자가 승인 (3절) |

`admin` 계정은 영향을 받지 않는다. 학생과 게스트의 **승인된 공용 맵 열람은
그대로 유지된다** — 잠기는 것은 쓰기와 남의 학습 기록 읽기뿐이다.

왜 기존 교사를 자동으로 통과시키지 않는가: 가입 폼이 역할을 그대로 받아
저장했기 때문에, `teacher` 행은 "누군가 teacher를 선택했다"는 사실만
증명한다. 초대받은 교사와 스스로 가입한 계정을 구별할 근거가 데이터에
없다. 관대한 쪽으로 추측하는 것이 지금 고치는 결함 자체다.

---

## 2. 배포 순서

```
1) 마이그레이션 적용        pnpm db:migrate
2) 애플리케이션 배포
3) 관리자 계정 확보         (아래 참조)
4) 교사 계정 확인           (관리자가 수행)
5) 학생에게 재수락 안내
```

마이그레이션과 배포 순서는 **마이그레이션이 먼저**다. 새 코드는
`teacher_verified_at`과 `consented_at`을 읽으므로, 컬럼이 없는 상태로
새 코드가 뜨면 에러가 난다. 반대로 마이그레이션만 먼저 적용된 상태는
안전하다 — 옛 코드는 새 컬럼을 보지 않는다.

### 관리자 계정이 없다면

공개 가입으로는 `admin`을 만들 수 없다(그것이 이번 수정의 일부다).
관리자가 하나도 없으면 교사를 확인해 줄 사람이 없으므로, DB에서 직접
한 번 승격시킨다.

```sql
-- 관리자로 쓸 계정을 이메일로 지정한다.
UPDATE users SET role = 'admin' WHERE lower(email) = lower('운영자@example.com');
```

이 한 줄이 유일하게 DB를 직접 만지는 단계다. 이후 교사 확인·권한 회수·연결
대행 승인은 전부 `/admin/teachers` 화면에서 한다. 브라우저 콘솔에서 Server
Action을 부를 일은 없다.

---

## 3. 교사 계정 확인

**관리자로 로그인해 `/admin/teachers` 에서 한다.** 검수 화면(`/admin`)의
`계정 관리` 탭에서 갈 수 있고, 관리자에게만 보인다. 교사나 게스트가 주소를
직접 입력하면 학습 화면으로 되돌아간다.

화면에는 네 가지가 있다.

| 구역 | 하는 일 |
| --- | --- |
| 확인 대기 중인 선생님 | `teacher` 이지만 확인되지 않은 계정을 확인 |
| 확인된 선생님 | 권한 회수 |
| 학생을 선생님으로 | 역할 변경과 확인을 함께 처리 |
| 답하지 않은 연결 요청 | 학생 대신 승인 |

서버 경로는 `grantTeacherRole`과 `revokeTeacherVerification`이며 둘 다
`requireRole('admin')`으로 보호된다. 교사 자신은 호출할 수 없다.

아래 SQL은 화면 대신 쓰라는 것이 아니라, 상태를 확인하거나 관리자 계정조차
없는 최초 1회를 위한 것이다.

```sql
SELECT id, email, display_name, role, teacher_verified_at
FROM users
WHERE role = 'teacher'
ORDER BY created_at;
```

`teacher_verified_at`이 `NULL`인 계정이 잠겨 있는 계정이다.

권한을 되돌릴 때는 `revokeTeacherVerification`을 쓴다. 역할은 `teacher`로
두고 확인 도장만 지우므로, 그 교사가 만든 맵·세트·연결은 전혀 건드리지
않는다. `requireCurator`가 매 호출마다 DB를 읽으므로 **다음 동작부터 즉시**
막힌다. 세션 만료를 기다리지 않는다.

화면을 쓸 수 없는 상황(관리자 계정이 아직 없을 때)에서는 DB에서 직접 할 수
있다.

```sql
-- 확인
UPDATE users
SET teacher_verified_at = now(),
    teacher_verified_by = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE lower(email) = lower('선생님@example.com') AND role = 'teacher';

-- 해제
UPDATE users
SET teacher_verified_at = NULL, teacher_verified_by = NULL
WHERE lower(email) = lower('선생님@example.com');
```

---

## 4. 교사-학생 연결 재확인

마이그레이션이 근거 없는 `active` 연결을 `pending`으로 되돌린다. 행은
남고, 그 학생의 복습 기록·카드·과제도 전부 남는다. 멈추는 것은 교사가 그
기록을 **읽는 것**뿐이다.

학생이 `/study` 화면 상단에서 **선생님 연결 요청**을 보고 수락하면 원래대로
돌아간다. 수락은 한 번이면 된다.

학생이 직접 하기 어려운 경우에만 관리자가 대신 승인한다. **`/admin/teachers`
의 `답하지 않은 연결 요청`** 에서 누르면 된다. 이때 `consented_by`에는
**관리자 id가 기록된다** — 학생이 눌렀다고 남기지 않는다. 교사에게는 두 경로
모두 열려 있지 않다.

재확인이 필요한 연결을 보려면:

```sql
SELECT l.id, t.email AS teacher, s.email AS student, l.status, l.consented_at
FROM teacher_student_links l
JOIN users t ON t.id = l.teacher_id
JOIN users s ON s.id = l.student_id
WHERE l.consented_at IS NULL
ORDER BY l.created_at;
```

학생에게 보낼 안내 문구 예시:

> 보안 개선으로 선생님 연결을 다시 확인하고 있습니다. 단어 화면 위쪽에
> 뜨는 **선생님 연결 요청**에서 수락해 주세요. 지금까지의 학습 기록은
> 그대로 있습니다.

---

## 5. 되돌리기

애플리케이션만 이전 버전으로 되돌리면 된다. 마이그레이션은 컬럼 추가와
상태 값 변경뿐이라 옛 코드에서도 동작한다. 다만 `pending`으로 내려간 연결은
옛 코드에서 다시 `active`가 되지 않으므로, 되돌린 상태에서 연결을 복구하려면
아래를 수동으로 실행해야 한다. **권한 결함이 함께 되살아나므로 권장하지
않는다.**

```sql
UPDATE teacher_student_links SET status = 'active' WHERE status = 'pending';
```

---

## 6. 새 콘텐츠의 승인 정책

단어장 가져오기로 만들어지는 **새 맵**은 지금까지처럼 `approved`로 들어간다.
가져오기 자체가 확인된 교사만 실행할 수 있게 되었으므로 권한 수정과
일관된다. 확인되지 않은 계정은 가져오기 화면에 도달하지 못한다.

**이미 맵이 있는 단어는 가져오기가 건드리지 않는다.** 기존 맵의 승인 상태,
내용, 버전, 항목 id, 번역, 수정 이력이 모두 유지되고, 이번 입력은 어디에도
반영되지 않는다. 그 사실은 가져오기 결과 메시지에 단어 이름과 함께
표시된다. 검수자가 명시적으로 고치는 경로(`writeDraft`, 재생성 버튼)는
그대로 남아 있으며, 가져오기 경로에서는 호출되지 않는다.

---

# P1 — 답안 무결성, 검수 파이프라인, CI

`0005_answer_integrity_and_reading_review` 마이그레이션과 함께 나가는 변경의
운영 절차다. 이 마이그레이션은 **컬럼 추가와 인덱스 추가뿐**이며 기존 행을
읽거나 고치지 않는다.

## 1. 적용 순서

```
1) 마이그레이션 적용        pnpm db:migrate
2) 애플리케이션 배포
```

P0 때와 같은 이유로 마이그레이션이 먼저다. 새 코드는
`review_events.submission_id`와 `brain_map_meanings.en_definition_ko_draft`를
읽는다. 반대로 마이그레이션만 먼저 적용된 상태는 안전하다 — 옛 코드는 새
컬럼을 보지 않는다.

운영자가 손으로 해야 할 일은 없다. P0와 달리 잠기는 기능도, 사용자에게 보낼
안내도 없다.

## 2. 이미 공개된 AI 해석은 그대로 둔다

`en_definition_ko`에 이미 들어 있는 해석은 승인된 콘텐츠로 취급하고 건드리지
않는다. 그중 상당수는 사람이 검수하지 않고 모델이 직접 쓴 것이지만, 지금
와서 일괄로 내리면 학생이 보던 화면에서 글이 사라진다. 앞으로 만들어지는
후보만 검수를 거친다.

이미 공개된 것 중 모델이 쓴 것을 골라내고 싶다면, 승인 기록이 없는 행이
후보다.

```sql
SELECT m.id, v.lemma, m.ko, m.en_definition_ko
FROM brain_map_meanings m
JOIN brain_maps b ON b.id = m.brain_map_id
JOIN vocabularies v ON v.id = b.vocabulary_id
WHERE m.en_definition_ko IS NOT NULL
  AND m.en_definition_ko_approved_at IS NULL
ORDER BY v.lemma;
```

이 목록을 비우려면 검수 화면에서 다시 볼 수 있게 해당 행의
`en_definition_ko`를 `en_definition_ko_draft`로 옮기면 된다. **권장하지
않는다** — 학생 화면에서 글이 사라지는 대가로 얻는 것이 크지 않다.

## 3. 과거 '해석 확인' 기록

`bcc28ad`(2026-09-09 배포)부터 이번 수정 전까지, 맵 학습 화면의 **해석 확인**
버튼이 정답 제출로 기록됐다. 그 기간에 눌린 해석 확인은 `review_events`에
`correct = true`인 행을 만들고 FSRS 카드를 전진시켰다.

### 식별 가능한 범위

선택형 문제의 `given`은 항상 보기 문구이므로 비어 있을 수 없다. 해석 확인은
입력란 내용을 그대로 보냈고 대개 비어 있다. 따라서 **해당 기간의
`given = ''`인 행은 해석 확인이 확실하다.**

```sql
SELECT id, user_id, vocabulary_id, question_type, reviewed_at
FROM review_events
WHERE reviewed_at >= timestamptz '2026-09-09 13:20+00'
  AND correct = true
  AND question_type IN ('sentence_translation', 'collocation_cloze', 'word_family_cloze')
  AND payload ->> 'given' = ''
ORDER BY reviewed_at;
```

### 식별 불가능한 범위

같은 기간에 학생이 해석을 **입력하고** 확인을 누른 경우, `given`이 비어 있지
않아 선택형 정답과 구별되지 않는다. 이 행들은 확실하게 골라낼 수 없다.

### 조치

**자동으로 지우거나 고치지 않는다.** 추정으로 과거 답안을 건드리면 진짜
정답까지 없앨 수 있고, 그쪽 손해가 더 크다.

지우더라도 FSRS 카드는 되돌아가지 않는다. 카드는 이벤트에서 파생되는 것이
아니라 답변마다 앞으로 밀린 상태값이라, 정확히 되돌리려면 해당 사용자·단어의
이벤트 로그를 처음부터 다시 재생해야 한다. 이번 범위에서는 하지 않는다.

영향 범위는 좁다. 해당 기간은 하루 남짓이고, 결과는 그 단어의 다음 복습이
실제보다 늦게 잡히는 것이다. 다음 오답 한 번으로 일정이 다시 당겨진다.

## 4. CI

`.github/workflows/deploy.yml`이 실행마다 임시 Postgres 컨테이너를 띄우고,
마이그레이션을 적용한 뒤 전체 테스트를 돌린다. DB 테스트가 skip되면 **실행을
실패시킨다** — skip된 결과가 통과처럼 보이던 것이 이번에 고친 것 중 하나다.

CI가 쓰는 것은 그 실행에서만 존재하는 빈 DB이며, 운영 비밀값은 테스트에
쓰이지 않는다. `resetDatabase`가 이름에 "test"가 없는 DB의 truncate를 거부하는
것이 두 번째 잠금이다.
