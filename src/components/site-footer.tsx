/**
 * Who made this — the last line on the screen.
 *
 * Beneath the navigation rather than above it, because a credit belongs at the
 * very bottom and nowhere else. That makes it permanent chrome, so it is built
 * to cost as little height as it can: one 10px line and a 24px mark, sharing
 * the strip the tab bar was already floating above.
 *
 * 24px is a floor, not a style choice. The mark sits a few pixels under the tab
 * bar, so anything smaller turns a slightly high tap into a navigation away
 * from the screen the reader was on.
 */
export function SiteFooter() {
  return (
    <footer className="mt-1.5 flex items-center justify-center gap-2">
      <span className="text-[0.625rem] leading-none text-ink-3">
        만든사람 <span className="font-medium text-ink-2">DADA</span>
      </span>

      {/* Off to another site, so it opens in its own tab and cannot reach back
          into this one through `window.opener`. The label carries what the
          pictogram cannot say out loud. */}
      <a
        href="https://dada-town.com/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="DADA 홈페이지 열기 (새 탭)"
        className="flex h-6 w-6 items-center justify-center rounded-chip text-ink-3 ring-1 ring-line transition hover:text-ink-2 hover:ring-ink-3/40"
      >
        {/* The navigation's icon family — 24px grid, 1.6 stroke, round caps —
            so the one glyph down here does not read as a stray from elsewhere. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.8Z" />
          <path d="M9.6 20v-5.2h4.8V20" />
        </svg>
      </a>
    </footer>
  )
}
