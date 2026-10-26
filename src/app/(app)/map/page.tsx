import { GoToStudy } from '@/components/go-to-study'

/**
 * 맵 탭은 단어장 안으로 들어갔다.
 *
 * 맵이 있다는 것은 단어의 성질이고, 목록의 모든 줄이 이미 어느 단어에 맵이
 * 있는지 말한다 — 같은 세트와 같은 단어를 맵 없는 것만 숨겨 보여주는 화면은
 * 이 화면이 다른 이름을 입고 있던 것이었다.
 *
 * 그대로 두는 것은 링크가 이미 밖에 나가 있기 때문이다: 북마크, 학생에게 보낸
 * 메시지, 예전 단어 화면마다 있던 "← 맵".
 */
export default function MapPage() {
  return <GoToStudy />
}
