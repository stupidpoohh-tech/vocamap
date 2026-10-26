'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { isBookmarked, toggleBookmark } from '@/learning/store'

/**
 * 한 번 눌러 "이건 모르겠다"고 적어 두는 것.
 *
 * 세트를 읽어 내려가면서 표시하는 방법이라, 줄 안에서 한 번 누르는 것으로
 * 끝나야 한다 — 화면을 여는 무엇이든 단어 스무 개를 못 버틴다.
 *
 * 컨트롤이 아니라 표시로 그린다. 한때 테두리 있는 알약이 테두리 있는 카드
 * 안의 테두리 있는 목록에 들어 있었는데, 별 하나를 세 겹으로 둘러싼 선이
 * 바로 그 옆의 단어를 묻는 소음이다.
 *
 * 예전에는 이 별이 서버에 적혔고, 그래서 계정이 없으면 로그인 화면으로
 * 보냈다. 이제 이 폰의 브라우저에 적힌다 — 계정을 묻지 않고, 대신 기기를
 * 넘어가지 않는다.
 */
export function BookmarkButton({
  slug,
  bookmarked,
  size = 'sm',
  onChange,
}: {
  slug: string
  /** 부모가 이미 읽어 둔 기록. 첫 그림이 깜빡이지 않게 받아 둔다. */
  bookmarked: boolean
  size?: 'sm' | 'lg'
  /** 목록이 '담은 것' 수와 걸러내기를 따라 움직여야 할 때. */
  onChange?: (next: boolean) => void
}) {
  /**
   * 누른 뒤의 상태. 누르기 전에는 비어 있고, 그동안은 부모가 읽어 온 것을
   * 그대로 보여준다 — 목록은 기록을 그려진 뒤에 읽어 오므로, 자기 상태를
   * 들고 있으면 늦게 도착한 기록을 못 따라간다.
   */
  const [pressed, setPressed] = useState<boolean | null>(null)
  const shown = pressed ?? bookmarked

  return (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={shown ? '보관함에서 빼기' : '모르는 단어로 보관함에 담기'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const next = isBookmarked(toggleBookmark(slug), slug)
        setPressed(next)
        onChange?.(next)
      }}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-chip transition',
        size === 'lg' ? 'px-2 py-1 text-xs' : 'p-1.5',
        // 한 줄에서 색이 나타나는 유일한 곳이고, 그것이 담아 둔 단어들의
        // 화면을 한눈에 읽히게 만든다.
        shown ? 'text-brand' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <span aria-hidden className="text-sm leading-none">
        {shown ? '★' : '☆'}
      </span>
      {size === 'lg' ? (shown ? '담았어요' : '모르는 단어') : null}
    </button>
  )
}
