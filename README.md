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
pnpm db:seed:demo          # 로컬 전용 — 예시 단어 + 데모 계정
pnpm dev
```

데모 계정 (비밀번호 `vocamap1234`, **로컬 전용**):

| 역할 | 이메일 |
| --- | --- |
| 학생 | `student@vocamap.local` |
| 선생님 | `teacher@vocamap.local` |
| 관리자 | `admin@vocamap.local` |

`pnpm db:reset-seed` 로 seed 데이터만 지우고 다시 넣을 수 있다. seed 단어는
`is_seed = true` 로 표시되므로 실제 콘텐츠와 섞이지 않는다.

> **`db:seed` 와 `db:seed:demo` 는 다르다.**
> `db:seed` 는 단어와 Brain Map만 넣는다 — 프로덕션에 그대로 써도 되는 내용이다.
> `db:seed:demo` 는 여기에 **비밀번호가 저장소에 적혀 있는 계정 3개**(admin 포함)를
> 추가한다. localhost가 아닌 DB를 가리키면 실행을 거부한다.

## 스크립트

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버 |
| `pnpm check` | 타입 검사 + 테스트 |
| `pnpm test` | 테스트 (DB 테스트는 `TEST_DATABASE_URL` 필요) |
| `pnpm db:generate` | schema 변경 → migration 파일 생성 |
| `pnpm db:migrate` | migration 적용 |
| `pnpm db:seed` | 단어 + Brain Map 삽입 (프로덕션 안전) |
| `pnpm db:seed:demo` | 위 + 데모 계정 (localhost 전용) |
| `pnpm db:reset-seed` | seed 데이터 삭제 후 재삽입 (localhost 전용) |
| `pnpm cf:preview` | 로컬 workerd에서 실행 (배포 전 확인용) |
| `pnpm cf:deploy` | Cloudflare Workers 배포 |
| `pnpm cf:size` | Worker 번들 크기 확인 |
| `pnpm db:export-sql` | `db/setup.sql` 재생성 (스키마 변경 후) |

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

**Cloudflare Workers** + Neon Postgres. workerd에서 전 기능 동작을 확인했다.

터미널 없이 배포하려면 [`docs/DEPLOY.md`](docs/DEPLOY.md) §3을 따른다 —
`db/setup.sql` 을 Neon SQL Editor에 붙여넣고, Cloudflare 대시보드에서 GitHub
저장소를 연결하면 끝난다.

```bash
cp .dev.vars.example .dev.vars   # 값 채우기
pnpm cf:preview                  # 로컬 workerd에서 확인
pnpm cf:deploy                   # 배포
```

Workers **유료 플랜($5/월)이 필요하다.** 번들은 1.21 MiB로 무료 한도(3 MiB) 안에
들어오지만, 비밀번호 해싱이 무료 플랜의 CPU 한도 10 ms를 넘는다 — 어떤 안전한
해시 알고리즘으로도 들어갈 수 없다.

`pnpm dev`(Node)와 `pnpm cf:preview`(workerd)는 런타임이 다르다. **배포 전에는
반드시 후자로 확인할 것.**

Vercel로도 그대로 배포된다. 자세한 내용과 Workers 대응 과정에서 바꾼 것들은
[`docs/DEPLOY.md`](docs/DEPLOY.md) 참고.

## 문서

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 구조, 스키마, 설계 근거, 반론
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — 배포 절차, 플랜 선택, Workers 제약
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 완료된 범위와 다음 단계
