/**
 * Who made this.
 *
 * Sits below the content and above the floating navigation, centred — a credit
 * line, not a section: one row of the quietest text on the screen, so it is
 * findable without ever competing with a word the reader is studying.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-2xl items-center justify-center gap-2.5 px-5 pb-28 pt-8">
      <span className="text-[0.6875rem] text-ink-3">
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
        className="flex h-8 w-8 items-center justify-center rounded-control text-ink-3 ring-1 ring-line transition hover:text-ink-2 hover:ring-ink-3/40"
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
          className="h-[1.0625rem] w-[1.0625rem]"
          aria-hidden
        >
          <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.8Z" />
          <path d="M9.6 20v-5.2h4.8V20" />
        </svg>
      </a>
    </footer>
  )
}
