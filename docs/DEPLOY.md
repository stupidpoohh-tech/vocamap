# 배포

## 결론부터

Cloudflare로 배포됩니다. 실제로 workerd에서 전 기능(로그인, 트랜잭션 쓰기, Brain
Map)이 돌아가는 것을 확인했습니다.

**단, Workers 유료 플랜($5/월)이 필요합니다.** 이유는 CPU 하나뿐입니다 (§2).

| 항목 | 측정값 | 무료 한도 | 판정 |
| --- | --- | --- | --- |
| Worker 번들 크기 | **1.21 MiB** (gzip) | 3 MiB | 통과 |
| 로그인 CPU (bcrypt) | **~160 ms** | 10 ms | **초과** |

## 1. 구성

```
Cloudflare Workers  ← 앱 (@opennextjs/cloudflare 어댑터)
        │  TCP
        ▼
Neon Postgres       ← DB (무료 tier)
```

DB만 Cloudflare 밖입니다. Cloudflare에는 Postgres가 없고, D1(SQLite)로 옮기려면
enum·partial index·JSONB·`distinct on` 같은 걸 전부 버려야 해서 권하지 않습니다.
Neon 무료 tier면 충분하고, DNS와 CDN은 Cloudflare로 통일됩니다.

## 2. 왜 유료 플랜인가

무료 플랜의 CPU 한도는 요청당 10 ms입니다. 비밀번호 해싱은 **일부러 느리게**
설계된 연산이라 여기에 들어갈 수가 없습니다. 실측:

| 방식 | CPU |
| --- | --- |
| bcrypt (cost 11) 검증 | 159 ms |
| PBKDF2-SHA256 100k | 49 ms |
| PBKDF2-SHA256 210k (OWASP 권장) | 126 ms |

**어떤 안전한 해시도 10 ms에 못 들어갑니다.** 알고리즘을 바꿔서 우회할 수 있는
문제가 아니라, 무료 플랜에서 로그인 기능 자체가 불가능한 것입니다. 유료 플랜은
30초라 여유가 큽니다.

번들 크기는 1.21 MiB라 무료 한도 3 MiB 안에 들어옵니다. 여기는 문제가 아닙니다.

## 3. 배포 절차

### 3-1. Neon

1. [neon.tech](https://neon.tech) 프로젝트 생성
2. **Pooled connection** 문자열 복사 → `DATABASE_URL`
3. **Direct connection** 문자열 복사 → migration용

### 3-2. 스키마 적용

로컬에서 한 번 실행합니다. 빌드 단계에 넣지 않습니다 — 스키마 변경을 배포 사고로
만들지 않기 위해서입니다.

```bash
DATABASE_URL_UNPOOLED="<direct URL>" pnpm db:migrate
DATABASE_URL="<pooled URL>" pnpm db:seed   # 선택
```

### 3-3. Secret 등록

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET        # openssl rand -base64 48
npx wrangler secret put ANTHROPIC_API_KEY
```

`LLM_PROVIDER` / `LLM_MODEL` 처럼 비밀이 아닌 값은 `wrangler.jsonc` 의 `vars` 에
두면 됩니다.

### 3-4. 배포

```bash
pnpm cf:deploy
```

### 3-5. 로컬에서 Worker로 확인

```bash
cp .dev.vars.example .dev.vars   # 값 채우기
pnpm cf:preview
```

`pnpm dev`(Node)와 `pnpm cf:preview`(workerd)는 **런타임이 다릅니다.** 배포 전에는
후자로 확인하세요. 아래 §4의 문제는 Node에서는 절대 재현되지 않습니다.

크기 확인:

```bash
pnpm cf:size
```

## 4. Workers 때문에 바꾼 것

### DB 클라이언트를 요청 단위로

Cloudflare는 **한 요청에서 만든 I/O 객체를 다른 요청에서 쓰는 것을 금지**합니다.
모듈 최상단에 커넥션 풀을 두면 첫 요청은 성공하고 **그다음부터 전부 hang** 합니다.
에러가 아니라 타임아웃으로 나타나서 원인 찾기가 고약합니다.

포팅 중 실제로 겪었습니다: 첫 로그인은 379 ms에 성공하고 두 번째부터
`Worker's code had hung` 이 떴습니다.

그래서 `src/lib/db/index.ts` 는:

- **지연 초기화** — Workers는 모듈 평가 중 I/O를 금지하고, `process.env` 도 요청
  시점에 채워집니다. 모듈 최상단에서 연결하면 isolate 시작부터 죽습니다.
- **Workers에서는 요청 단위 캐시** — React `cache()` 로 한 요청 안에서만 클라이언트를
  공유합니다. Node에서는 기존대로 프로세스 단위 풀을 씁니다.

`tests/db-client.test.ts` 가 이 두 성질을 고정합니다.

### 드라이버는 그대로

`postgres` (postgres.js) 는 `workerd` export 조건으로 Cloudflare TCP 소켓 빌드를
제공합니다. **드라이버 교체는 필요 없었습니다.** 트랜잭션도 그대로 동작합니다
(Neon HTTP 드라이버였다면 트랜잭션을 못 써서 `recordRecallAnswer` 를 다시 짜야
했을 겁니다).

## 5. 나중에 볼 것

- **Hyperdrive** — Cloudflare가 Postgres 커넥션을 자기 쪽에서 풀링해 줍니다. 요청마다
  새 연결을 맺는 비용이 줄어듭니다. 유료 플랜에 포함이고, 학생 수가 늘어 지연이
  체감되면 그때 붙이면 됩니다. 지금은 Neon pooled endpoint로 충분합니다.
- **커스텀 도메인** — Workers 라우트에 도메인 연결
- **R2 증분 캐시** — 현재는 전부 동적 렌더라 이득이 없습니다

## 6. Vercel로 배포하려면

`wrangler.jsonc` 와 `open-next.config.ts` 를 무시하고 repo를 연결한 뒤 환경 변수만
넣으면 됩니다. 앱 코드는 두 런타임 모두에서 동작합니다.
