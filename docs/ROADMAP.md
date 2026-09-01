# 구현 범위와 다음 단계

## 완료

### PHASE 1 — architecture + schema + auth
- 22개 테이블. Master/Personal 분리, 공용 지식 베이스 제약, 이벤트 로그
- 이메일+비밀번호 인증, 세션, `student` / `teacher` / `admin` 역할
- Application layer 인가 게이트 (`assertCanAccessStudent`)

### PHASE 2 — vocabulary + Recall + Retention
- 단어 중복 방지, 한/영 검색, 세트, 배정, 붙여넣기 import
- 영한 / 한영 recall, 방향별 독립 스케줄
- FSRS 기반 retention, 모든 답변의 event 기록
- 오늘의 복습 queue (due 우선, 새 단어 제한), 틀린 단어 반복

### PHASE 3 — Master Brain Map UI
- CSS radial map, 노드 상태 5단계
- 5개 노드 전부 학습 활동으로 구현
- 손으로 쓴 seed: `maintain`, `affect`, `issue` (풍부) + 7단어

### PHASE 4 — AI generation + review
- provider 추상화 (Anthropic / OpenAI / mock), 모델은 환경 변수
- 구조화 출력 + zod + 교차 검증
- draft → approved workflow, 검수 UI, 재생성, 승인/반려
- 중복 생성 방지 (partial unique index)

### PHASE 5 — Personal Brain Map
- 노드별 진행도와 약점 감지
- 학생별 confusion graph
- 확장 추천 정책 + 홈 화면 노출
- 학생/교사 중요 단어 지정

## 다음 단계 (우선순위 순)

### 1. 실제 학생 투입 (코드 아님)
가장 중요한 다음 단계는 기능 추가가 아니라, 실제 과외 학생 1~2명을 한 달 붙여
보는 것이다. 아래 항목 대부분은 그 관찰 없이 만들면 틀린 것을 만들게 된다.

특히 확인할 것:
- 확장 추천 임계값(lapse 3회, 정답률 60%)이 실제로 맞는 타이밍인가
- 하루 새 단어 10개가 적절한가
- 학생이 Brain Map을 실제로 여는가, 아니면 무시하는가

### 2. AI 번역 평가
예문 노드는 현재 학생이 스스로 채점한다. `LLMProvider.evaluateTranslation()` 을
붙일 자리는 이미 있고, 답변 구조도 그에 맞춰 저장하고 있다.

### 3. 타이핑 recall
현재는 4지선다. `recall_typed` 는 스키마와 등급 매핑에 이미 존재한다. 객관식보다
회상 강도가 높으므로, 학생이 익숙해진 뒤 단계적으로 도입할 만하다.

### 4. Teacher 확장
Class/Group, 과제 마감, 학생별 분석 대시보드. 테이블과 관계는 이미 있다.

### 5. 검수 도구 개선
현재 검수는 승인/반려/재생성만 된다. 문장 하나만 고치거나 유사어 짝 하나만 빼는
편집 UI가 필요해지는 시점이 온다 — 다만 초안 품질을 실제로 본 뒤에 만들어야 한다.

### 6. 알림
`due_at` 기반이라 지금은 cron이 필요 없다. push/이메일 알림을 붙이는 시점에
Vercel Cron을 도입하면 된다.

## 의도적으로 하지 않은 것

- **pgvector / Vector DB** — 수천 단어에서 Postgres로 충분하다
- **Cloudflare Workers / R2 / Vectorize** — 지금 푸는 문제가 없다
- **Row Level Security** — `docs/ARCHITECTURE.md` §4
- **게임화 (배지, 스트릭, 랭킹)** — "학생이 단어를 더 오래 기억하거나 더 깊이
  이해하는 데 실제로 도움이 되는가"에 확신을 갖고 답할 수 없다
