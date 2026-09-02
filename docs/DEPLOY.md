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

## 3. 배포 절차 (터미널 없이)

전부 브라우저 화면에서 됩니다.

### 3-1. Neon 프로젝트 만들기

1. [neon.tech](https://neon.tech) 로그인
2. **Create project**
3. Name `vocamap`, Region **AWS Asia Pacific (Tokyo)**
4. **Create**

생성 직후 연결 문자열 화면에서 **두 개**를 각각 복사해 둡니다.

- **Pooled connection** — 주소에 `-pooler` 가 있음 → 앱이 쓸 주소
- **Direct connection** — `-pooler` 없음 → 지금은 안 쓰지만 나중에 필요

### 3-2. 스키마와 예시 데이터 넣기

저장소의 **`db/setup.sql`** 파일 하나면 됩니다. 테이블·인덱스·제약조건 전부와
예시 단어 10개(Brain Map 3개 포함)가 들어 있고, **계정과 비밀번호는 들어 있지
않습니다.**

1. Neon 왼쪽 메뉴 **SQL Editor**
2. `db/setup.sql` 내용 전체를 붙여넣기
3. **Run**

빈 데이터베이스에 **한 번만** 실행합니다.

이 파일은 손으로 쓴 게 아니라 실제 migration과 seed 스크립트로부터
`pnpm db:export-sql` 로 생성됩니다. 스키마를 바꾸면 다시 생성해야 합니다.

### 3-3. Cloudflare 유료 전환

1. [dash.cloudflare.com](https://dash.cloudflare.com) 로그인
2. 왼쪽 **Compute (Workers)** → **Plans**
3. **Workers Paid** 선택 → 결제

§2의 이유로 필수입니다.

### 3-4. GitHub 저장소 연결해서 배포

1. 왼쪽 **Compute (Workers)** → **Create**
2. **Import a repository** 탭
3. GitHub 계정 연결 → `stupidpoohh-tech/vocamap` 선택
4. 빌드 설정:

   | 항목 | 값 |
   | --- | --- |
   | Build command | `pnpm cf:build` |
   | Deploy command | `npx wrangler deploy` |

5. **Create and deploy**

배포되면 `https://vocamap.<계정>.workers.dev` 주소가 나옵니다. 아직 DB 주소를 안
줬으므로 접속하면 에러가 납니다 — 정상입니다.

Node 버전은 `.node-version` 파일로 고정되어 있어 따로 설정하지 않아도 됩니다.

### 3-5. 비밀값 넣기

1. **Compute (Workers)** → `vocamap` 선택
2. **Settings** 탭 → **Variables and Secrets**
3. **Add** → Type **Secret** → 아래 3개를 하나씩

   | Variable name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **Pooled** 주소 |
   | `AUTH_SECRET` | 무작위 문자열 48자 이상 |
   | `ANTHROPIC_API_KEY` | Anthropic 키 (없으면 생략 가능) |

4. **Deploy**

`ANTHROPIC_API_KEY` 를 생략하면 AI 초안 생성만 안 되고 나머지는 전부 동작합니다.

### 3-5-1. 연결 문자열 주의점

Neon이 보여주는 연결 문자열에는 `channel_binding=require` 가 붙어 있습니다. 이는
libpq 전용 옵션이고 이 앱이 쓰는 드라이버(postgres.js)는 구현하지 않습니다. 그대로
두면 드라이버가 이 값을 **서버 설정값으로 잘못 전달**해서 모든 쿼리가 실패합니다.

```
42704  unrecognized configuration parameter "channel_binding"
```

앱이 연결 시 이 파라미터를 자동으로 제거하므로 **붙여넣은 그대로 쓰셔도 됩니다.**
`sslmode` 는 건드리지 않으니 TLS는 그대로 적용됩니다.

증상이 고약한 이유: 랜딩과 로그인 화면은 DB를 건드리지 않아 멀쩡해 보이고, 회원가입
같은 **첫 DB 쓰기에서만** 터집니다.

### 3-6. 확인

3-4에서 받은 주소로 접속 → 로그인 화면이 뜨면 완료입니다.

첫 사용자는 화면에서 **회원가입** 으로 직접 만듭니다. 배포된 DB에는 계정이
하나도 없는 상태이므로, 먼저 가입하는 사람이 본인 계정이 됩니다.

### 3-7. 이후 코드 변경

기본 브랜치에 push 되면 Cloudflare가 자동으로 다시 빌드·배포합니다. 비밀값은 다시
넣지 않아도 됩니다.

## 3-B. 터미널을 쓰는 경우

CLI가 편하다면 위 3-2·3-4·3-5 대신:

```bash
DATABASE_URL_UNPOOLED="<direct URL>" pnpm db:migrate
DATABASE_URL="<pooled URL>" pnpm db:seed
npx wrangler login
pnpm cf:deploy
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
```

`db:seed` 는 단어와 Brain Map만 넣습니다. **`db:seed:demo` 는 절대 쓰지 마세요** —
비밀번호가 저장소에 적힌 계정 3개(admin 포함)를 만듭니다. localhost가 아니면
거부하도록 막아 두었지만, 애초에 쓸 일이 없습니다.

## 3-C. 문제가 생겼을 때

배포된 주소에 **`/api/health`** 를 붙여 접속하면 DB 상태를 볼 수 있습니다.

```
정상  {"ok":true,"database":"ok","seededWords":12,"strippedParams":["channel_binding"]}
장애  {"ok":false,"database":"error","code":"3D000","hint":"해당 이름의 데이터베이스가 없습니다."}
```

`code` 별 의미는 응답의 `hint` 에 함께 나옵니다. 자격 증명이나 호스트 주소는 절대
노출하지 않습니다.

더 자세한 로그는 Cloudflare 대시보드 → **Compute (Workers)** → `vocamap` →
**Logs** 에서 볼 수 있습니다.

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
