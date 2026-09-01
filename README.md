# Voca Brain Map

암기는 반복하고, 이해가 필요한 단어는 연결한다.

대부분의 단어는 반복으로 외우고, 학생이 실제로 막히는 단어에만 Brain Map을 펼쳐
의미·문장·유사어·연어·파생어까지 연결해 학습하는 영어 어휘 서비스.

핵심 loop:

```
ENCOUNTER → RECALL → RETENTION → 어려운/중요 단어 감지
   → BRAIN MAP 확장 → UNDERSTANDING → RECALL 다시
```

## 빠른 시작

```bash
pnpm install
cp .env.example .env      # DATABASE_URL, AUTH_SECRET 채우기
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Seed 계정 (비밀번호 `vocamap1234`):

| 역할 | 이메일 |
| --- | --- |
| 학생 | `student@vocamap.local` |
| 선생님 | `teacher@vocamap.local` |
| 관리자 | `admin@vocamap.local` |

`pnpm db:reset-seed` 로 seed 데이터만 지우고 다시 넣을 수 있다. seed 단어는
`is_seed = true` 로 표시되므로 실제 콘텐츠와 섞이지 않는다.

## 스크립트

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버 |
| `pnpm check` | 타입 검사 + 테스트 |
| `pnpm test` | 테스트 (DB 테스트는 `TEST_DATABASE_URL` 필요) |
| `pnpm db:generate` | schema 변경 → migration 파일 생성 |
| `pnpm db:migrate` | migration 적용 |
| `pnpm db:seed` | seed 데이터 삽입 |
| `pnpm db:reset-seed` | seed 데이터 삭제 후 재삽입 |

## 환경 변수

`.env.example` 참고. 최소한 다음이 필요하다.

- `DATABASE_URL` — Postgres 연결 문자열 (Neon 무료 tier 기준)
- `AUTH_SECRET` — 32자 이상. `openssl rand -base64 48`
- `TEST_DATABASE_URL` — **테스트 전용 DB.** 테스트는 모든 테이블을 truncate 하므로
  개발 DB를 절대 가리키면 안 된다. 이름에 `test` 가 없으면 실행을 거부한다.

LLM 키가 없어도 `LLM_PROVIDER=mock` 으로 생성 → 검수 → 승인 흐름 전체를 돌려볼 수
있다. 이때 생성되는 콘텐츠는 `[예시]` 로 표시된 자리표시 데이터다.

## 데이터베이스

Supabase 대신 **Neon**(무료 serverless Postgres)을 쓴다. 이유와 그로 인해 달라진
점(특히 RLS 대신 application layer 인가)은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
에 정리했다.

표준 Postgres만 쓰므로 Supabase slot이 나면 `DATABASE_URL` 교체와 auth 이관만으로
옮길 수 있다.

## 배포

Vercel + Neon 조합을 전제로 한다.

1. Vercel에 GitHub repo 연결
2. 환경 변수 등록 (`DATABASE_URL`, `AUTH_SECRET`, LLM 키)
3. 배포 후 `pnpm db:migrate` 를 한 번 실행 (직접 연결 URL 사용)

migration은 빌드 단계에서 자동 실행하지 않는다. 스키마 변경을 배포 사고로 만들지
않기 위한 의도적인 선택이다.

## 문서

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 구조, 스키마, 설계 근거, 반론
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 완료된 범위와 다음 단계
