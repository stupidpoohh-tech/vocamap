# Voca Brain Map

암기는 반복하고, 이해가 필요한 단어는 연결한다.

대부분의 단어는 반복으로 외우고, 학생이 실제로 막히는 단어에만 Brain Map을 펼쳐
의미·문장·연어·파생어까지 연결해 학습하는 영어 어휘 서비스.

핵심 loop:

```
ENCOUNTER → RECALL → RETENTION → 어려운/중요 단어 감지
   → BRAIN MAP 확장 → UNDERSTANDING → RECALL 다시
```

## 어디에 무엇이 사는가

이 앱에는 서버가 들고 있는 상태가 없다. 두 가지가 완전히 갈라져 있다.

**콘텐츠 — 저장소의 파일.** 단어, 뜻, 맵은 `content/` 아래 평문 파일이다.
빌드할 때 한 번 읽어 화면을 미리 구워 두고, 요청마다 만들지 않는다. 바뀌는
빈도가 하루에 몇 번일까 말까 한 것이라 그렇게 할 이유가 없다.

```
content/
  sets/*.tsv     한 줄이 단어 하나. 탭으로 나뉜다 (뜻에 쉼표가 흔해서)
  maps/*.json    승인된 Brain Map. 파일 이름이 주소에 쓰이는 이름이다
  README.md      선생님이 GitHub 웹에서 단어를 더하는 방법 — 터미널을 쓰지 않는다
```

**학습 기록 — 그 폰의 브라우저.** 담아 둔 단어, FSRS 일정, 틀린 횟수, 맵
노드별 진도는 `localStorage` 에 있다. 서버는 누가 보는지 모른다.

그래서 잃은 것이 분명하다 — 기기를 바꾸거나 브라우저 데이터를 지우면 기록이
사라지고, 선생님이 학생의 진도를 볼 수 없다. 알고 고른 쪽이다. 이유는 아래
"왜 이렇게 되었나".

일정 계산(FSRS)과 문제를 만드는 규칙은 바뀌지 않았다. `src/lib/learning/` 의
순수 모듈이고, 서버에 있을 때와 같은 함수가 브라우저에서 돈다.

## 빠른 시작

```bash
pnpm install
pnpm dev
```

환경 변수도, 데이터베이스도, 계정도 없다.

## 스크립트

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버 |
| `pnpm check` | 타입 검사 + 시험 |
| `pnpm test` | 시험 (전부 순수 함수라 건너뛰는 것이 없다) |
| `pnpm cf:preview` | 로컬 workerd에서 실행 (배포 전 확인용) |
| `pnpm cf:deploy` | Cloudflare Workers 배포 |
| `pnpm cf:size` | Worker 번들 크기 확인 |

## 단어를 더하려면

[`content/README.md`](content/README.md). GitHub 웹에서 `content/sets/` 의
파일을 고쳐 커밋하면 배포까지 자동으로 간다.

## 배포

**Cloudflare Workers**, 무료 플랜.

```bash
pnpm cf:preview   # 로컬 workerd에서 확인
pnpm cf:deploy    # 배포
```

`claude/voca-brain-map-mvp-y8xotu` 에 푸시하는 것이 곧 배포다
(`.github/workflows/deploy.yml`). 타입 검사와 시험과 빌드가 먼저 돌고, 전부
통과했을 때만 배포한다.

`pnpm dev`(Node)와 `pnpm cf:preview`(workerd)는 런타임이 다르다. **배포 전에는
반드시 후자로 확인할 것.**

## 왜 이렇게 되었나

Workers 무료 플랜은 요청 한 번에 CPU 10 ms를 준다. 측정해 보니 예전 구조는
가장 싼 화면이 15 ms였고, 그 비용은 데이터 조회가 아니라 **요청마다 React를
서버에서 그리는 행위 자체**에 있었다 — 프로파일에서 `src/lib/*` 전부가
0.6 ms였다. 개인화를 걷어내도 15 ms는 그대로였다.

그래서 요청마다 그리는 것을 그만두었다. 콘텐츠를 파일로 옮기고 화면을 미리
구우면 서버가 할 일이 없고, 개인 기록은 브라우저가 자기 것을 얹는다.

로그인·교사·검수 화면과 Postgres는 이 과정에서 없어졌다. 서버에 남의 기록이
없으면 가려낼 경계도 없다. Neon 데이터베이스와 그 안의 내용은 지우지 않았다 —
`content/` 는 거기서 내보낸 것이고(`scripts/export/`), 돌아가려면 되돌릴 수
있다.

지금 측정값(workerd, 요청당 CPU):

| 화면 | CPU |
| --- | --- |
| `/`, `/study` | 2.25 ms |
| `/words/[slug]` | 4.25 ms |
| `/vault` | 2.75 ms |
| `/study/session` | 2.50 ms |

## 문서

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 완료된 범위와 다음 단계
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
  [`docs/DEPLOY.md`](docs/DEPLOY.md),
  [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — **데이터베이스가 있던 때의
  구조다.** 계정·권한·마이그레이션·Hyperdrive에 대한 내용은 지금 코드에
  해당하지 않는다. 그때로 되돌릴 때의 기록으로 남겨 두었다.
