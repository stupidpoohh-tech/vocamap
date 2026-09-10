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

이 한 줄이 유일하게 DB를 직접 만지는 단계다. 이후는 전부 화면에서 한다.

---

## 3. 교사 계정 확인

관리자가 사람을 보고 판단한다. 서버 경로는 `grantTeacherRole`이며
`requireRole('admin')`으로 보호된다. 교사 자신은 호출할 수 없다.

확인이 필요한 계정을 먼저 본다.

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

DB에서 직접 할 수도 있다.

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

학생이 직접 하기 어려운 경우에만 관리자가 대신 승인한다
(`approveLinkForStudent`). 이때 `consented_by`에는 **관리자 id가 기록된다** —
학생이 눌렀다고 남기지 않는다. 교사에게는 두 경로 모두 열려 있지 않다.

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
