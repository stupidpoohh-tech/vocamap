# Architecture

이 문서는 "무엇을 만들었는가"보다 **"왜 그렇게 했는가"**를 남긴다. 코드가 스스로
설명하는 부분은 생략한다.

## 1. 스택과 그 이유

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) | Server Component + Server Action으로 API layer 없이 서버에서 직접 읽고 쓴다. 1인 개발에서 유지할 표면이 줄어든다. |
| DB | **Neon** (serverless Postgres) | Supabase slot 부족에 대한 대안. 진짜 Postgres이므로 스키마 설계가 그대로 살아있고, 나중에 pgvector도 붙는다. |
| ORM | Drizzle | 스키마가 곧 TypeScript 타입. migration이 검토 가능한 SQL 파일로 남는다. |
| Auth | 자체 세션 (jose + bcrypt) | 아래 §3 참조 |
| SRS | `ts-fsrs` | 검증된 FSRS 구현. 간격 규칙을 직접 만들지 않는다. |
| Styling | Tailwind v4 | 토큰을 CSS에 두고 색을 상태 표현에만 쓴다. |

### Supabase를 쓰지 않으면서 잃은 것과 메운 방법

| Supabase 기능 | 대체 |
| --- | --- |
| Postgres | Neon (동일) |
| Auth | 자체 세션 (§3) |
| Row Level Security | Application layer 인가 (§4) |
| Storage | MVP에 파일 업로드 없음. 필요해지면 Vercel Blob 또는 Cloudflare R2 |
| Edge Functions | Next.js Route Handler / Server Action |
| Cron | 현재 불필요 (§5) |

**이식성**: Neon 고유 기능은 쓰지 않는다. 연결 문자열 하나가 유일한 결합점이므로
Supabase slot이 나면 그때 옮겨도 된다.

## 2. 가장 중요한 경계: Master vs Personal

```
Master Brain Map  = WHAT THE WORD IS      (공용, 검수됨, 단어당 1개)
Personal Brain Map = HOW THIS STUDENT KNOWS IT (학생별, 검수 대상 아님)
```

이 둘은 테이블도, 읽기 경로도, 캐시 특성도 다르다.

- `brain_maps` 와 그 자식 테이블 — 학생이 몇 명이든 단어당 한 벌
- `user_vocabulary_cards`, `brain_map_node_progress`, `user_confusions` — 학생별

`getMasterBrainMap()` 과 `getPersonalBrainMap()` 은 별도 함수이고, 화면을 그릴 때만
`getBrainMapView()` 에서 합쳐진다. 이 분리가 §6의 공용 지식 베이스를 가능하게 한다.

## 3. 인증

Auth.js v5는 오랫동안 beta이고, 이 서비스에는 social login 요구가 없다. 과외
선생님이 학생 계정을 만들어 주는 사용 방식에는 이메일+비밀번호로 충분하다.

그래서 `src/lib/auth/` 에 최소 세션을 직접 구현했다. 약 150줄이고, 바꿔 끼우기
쉽도록 그 디렉터리 밖으로 새지 않는다.

쿠키에는 사용자 정보가 아니라 **`sessions` row에 대한 서명된 참조**만 담는다.
요청마다 인덱스 조회가 한 번 더 들지만, "이 학생을 모든 기기에서 로그아웃" 이
DELETE 한 줄이 된다.

## 4. 인가 — RLS를 쓰지 않는 이유

Postgres RLS는 요청마다 별도 role로 연결할 때만 실제로 구속력이 있다. serverless
환경의 pooled connection에서는 이게 번거롭고, 어설프게 설정하면 **켜져 있는데
동작하지 않는** 최악의 상태가 된다.

대신 모든 교사 측 읽기가 `assertCanAccessStudent()` 한 곳을 지나가게 했다.
`teacher_student_links` 에 active row가 없으면 어떤 학생 데이터에도 닿을 수 없다.
학생 자신의 데이터는 세션의 `actor.id` 로만 조회한다 — 클라이언트가 보낸 id는
어떤 경로에서도 신뢰하지 않는다.

이 선택의 대가는 **규율**이다: 새 쿼리를 추가할 때 이 게이트를 우회하면 아무도
막아주지 않는다. 그래서 `tests/authorization.test.ts` 가 8가지 경우를 고정한다.

향후 팀이 커지거나 직접 DB 접근이 생기면 RLS를 추가로 켜는 것이 맞다. 스키마는
그때를 위해 이미 `user_id` 기준으로 정규화되어 있다.

## 5. Retention

`ts-fsrs` 에 위임한다. 이 모듈이 하는 일은 하나뿐이다: **UI가 모으는 정답/오답 +
응답 시간을 FSRS가 원하는 4단계 등급으로 변환**하는 것.

```
오답                          → Again
정답이지만 느림 (>12s)        → Hard
정답                          → Good
정답이고 빠름 (<3.5s), Review → Easy
```

`Easy` 를 새 카드에 주지 않는 이유: 처음 본 단어를 빨리 맞히는 것은 오래 기억한다는
증거가 아니다.

### 저장하지 않는 것

`estimated_retention` 은 **컬럼으로 두지 않는다.** 시간이 지나면 계속 변하므로
저장하는 순간 틀린 값이 된다. `(stability, 경과 시간)` 에서 읽을 때 계산한다.

### 방향별 카드

`(user, vocabulary, direction)` 마다 카드가 하나씩이다. `maintain → 유지하다` 를
안다는 것이 `유지하다 → maintain` 을 안다는 뜻은 아니기 때문이다. due queue 조회가
`WHERE user_id = ? AND due_at <= now()` 하나로 끝나는 부수 효과도 있다.

### Cron이 필요 없는 이유

다음 복습 시각은 답변 시점에 계산되어 `due_at` 에 저장된다. queue는 "지금보다
`due_at` 이 이른 카드"를 읽기만 하면 되므로, 배치로 밀어줄 것이 없다. 알림을
붙이는 시점에 Vercel Cron을 도입하면 된다.

## 6. 공용 지식 베이스

서비스의 장기 자산이다. 이를 지키는 장치는 세 가지다.

1. **`vocabularies_natural_key`** — `(lower(lemma), language, part_of_speech)` unique.
   `findOrCreateVocabulary()` 가 유일한 writer다.
2. **`brain_maps.vocabulary_id` unique** — 단어당 Master Map은 하나뿐.
3. **`ai_jobs_inflight_unique`** — `status in ('pending','running')` 인 job에 대한
   partial unique index. 두 학생이 같은 단어를 동시에 건드려도 생성은 한 번만 돈다.

교사가 학생에게 100개를 넣으면 이미 아는 87개는 기존 Map을 그대로 쓰고 13개만
생성된다. 이 동작은 UI에서 실제로 확인된다("새 단어 2개, 기존 단어 재사용 2개").

### 혼동 단어 짝을 top-level에 둔 이유

`word_pairs` 는 특정 Brain Map의 자식이 아니라 독립 엔티티다. "maintain vs keep"은
대칭이고 양쪽 단어에서 모두 도달해야 하기 때문이다. lemma를 정렬해 저장하므로
`keep vs maintain` 도 같은 row가 된다. 차이 설명과 문제를 한 벌만 관리한다.

## 7. AI 생성

```
AI = Creator   →   Teacher/Admin = Curator   →   Student = Learner
```

학생이 단어를 누를 때마다 LLM을 호출하지 않는다. 생성은 교사/관리자만 트리거할 수
있고, 결과는 `draft_ai` 로 들어가 **승인 전까지 학생에게 보이지 않는다.**

### 품질 통제

1. **구조화 출력** — Anthropic은 tool use, OpenAI는 json_schema. prose 덩어리를 DB에
   넣지 않는다.
2. **zod 검증** — 배열 길이 상한이 있다. Brain Map의 가치는 선별에 있다.
3. **교차 검증** (`validateDraftConsistency`) — 스키마가 표현할 수 없는 것들:
   `highlight` 가 문장 안에 실제로 있는지, 예문들이 서로 다른 용법인지, 빈칸이 정확히
   하나인지.
4. **빈 배열 허용** — 모델에게 "반드시 채워라"라고 하지 않는다. 없는 파생어를
   지어내는 것이 비어 있는 것보다 나쁘다.

`prompt_version` 과 `generated_by_model` 을 모든 Map에 남기므로, 나중에 품질 문제가
생기면 어느 프롬프트가 만든 것인지 추적하고 선별 재생성할 수 있다.

### 버전 관리

`brain_map_revisions` 에 JSONB snapshot을 append한다. 자식 테이블 6개를 전부
temporal versioning하는 것은 이 규모에서 과하다. "N번 버전이 어땠고 누가 바꿨는가"에
답할 수 있으면 충분하다.

**Map을 수정해도 학생 학습 기록은 지워지지 않는다.** `review_events` 와
`brain_map_node_progress` 는 콘텐츠가 아니라 `vocabulary_id` 를 참조하기 때문이다.

## 8. Brain Map 확장 판단

`src/lib/learning/brain-map-policy.ts` — DB를 모르는 순수 모듈.

세 부류로 나눈다.

- **known** — 이미 아는 단어. 빠르게 통과.
- **memorise** — 약하지만 이해 문제는 아님. 반복 출제.
- **understand** — 확장 추천.

`understand` 가 되는 조건:

- 사람이 지정 (교사/학생/시험) → **즉시**. 세 번 틀릴 때까지 기다릴 이유가 없다.
- lapse ≥ 3, 또는 최근 8회 정답률 < 60%
- 유사어 / 문장 해석 / 연어 문제에서 2회 이상 오답

추천은 **끈적하게(sticky)** 유지된다. 학생이 Map을 열기 전까지 사라지지 않는다.
켜졌다 꺼졌다 하는 추천은 없느니만 못하다.

## 9. UI 판단

### 그래프 라이브러리를 쓰지 않았다

Brain Map은 CSS transform 기반 radial layout이다. 노드 5개의 각도가 고정이므로
계산할 layout이 없고, resize에 다시 그릴 것이 없으며, 360px에서도 읽히고 눌린다.
force-directed 그래프는 더 인상적이고 폰에서 더 나쁘다.

**색은 상태만 표현한다.** 회색=콘텐츠 없음, 파랑=학습 가능/중, 빨강=약함, 초록=완료.

### 노드는 보여주기가 아니라 활동이다

- 예문 — 먼저 직접 해석하고 나서 확인한다. 번역이 이미 보이는 문장을 읽는 것은
  학습이 아니다.
- 유사어 — 목록이 아니라 차이를 묻는 문제.
- 파생어 — 빈칸에 맞는 형태를 고르는 문제. 실제 시험 기능이 그것이므로.

콘텐츠가 없는 노드는 `locked` 로 렌더된다. 빈 노드로 학생을 초대하지 않는다.

### 학생에게 숨기는 것

`stability`, `difficulty`, SRS interval은 노출하지 않는다. 대신 "기억 안정도:
높음/보통/위험", "다음 복습 3일 후".

## 10. 요구사항에 대한 반론

요청받은 것 중 의도적으로 다르게 한 부분들이다.

**`estimated_retention` 을 컬럼으로 두지 않았다.**
매초 변하는 값이므로 저장하는 순간 낡는다. `stability` 와 `difficulty` 만 저장하고
읽을 때 계산한다. UI가 보는 값은 항상 정확하다.

**`vocabulary_meanings` 를 별도 사전 테이블로 만들지 않았다.**
Brain Map의 `meaning_core` 와 병렬로 두면 같은 정보가 두 곳에 생기고 반드시
어긋난다. 뜻은 `brain_map_meanings` 하나에 두고, recall용 한국어 gloss만
`vocabulary_translations` 로 분리했다. 역할이 다르기 때문이다.

**Brain Map 전체를 temporal versioning하지 않았다.**
자식 테이블 6개에 유효기간을 다는 것은 1인 운영에서 과하다. append-only JSONB
snapshot으로 충분하다.

**Teacher 기능은 스키마만 갖추고 UI는 최소로 했다.**
Class/Group, Assignment 만료, Analytics 대시보드는 테이블과 관계만 준비했다.
학생이 실제로 붙기 전에 만들면 틀린 것을 만들게 된다.

**pgvector / Vector DB — 넣지 않았다.** (요청과 같은 결론)
수천 단어 규모에서 Postgres prefix index가 1ms 안에 답한다. 실제 semantic search
요구가 생기기 전에는 도입할 이유가 없다.

**Cloudflare Workers / R2 / Vectorize — 넣지 않았다.** (요청과 같은 결론)
지금 해결하는 문제가 없다.

## 11. 테스트가 고정하는 것

`pnpm test` — 69개. 순수 로직은 DB 없이, 나머지는 `TEST_DATABASE_URL` 이 있을 때만.

의도적으로 다음을 고정한다.

- FSRS 등급 매핑과 간격 증가, 오답 시 lapse와 streak 초기화
- 확장 정책의 세 부류, 사람 지정의 즉시성, 노드 상태 파생
- AI 출력 스키마: 빈 배열 허용, 길이 상한, 알 수 없는 필드 제거, 교차 검증
- **손으로 쓴 seed Brain Map이 AI와 똑같은 검증을 통과하는지** — seed가 품질 기준이므로
- 단어 중복 방지 (대소문자, 공백, 품사 동음이의어, 품사 없음)
- Master Map 재사용: 두 번째 요청은 생성하지 않음, 동시 요청은 한 번만 생성,
  실패 시 lock 해제
- 짝이 양쪽 단어에서 같은 row인지
- 학생 간 상태 격리
- 교사 접근 게이트 8가지 경우

### 테스트 DB 격리

테스트는 모든 테이블을 truncate한다. 그래서 `TEST_DATABASE_URL` 만 읽고, DB 이름에
`test` 가 없으면 실행을 거부한다. (개발 중 실제로 개발 DB를 날려서 추가한 안전장치다.)
