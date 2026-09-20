/**
 * The front door is the word list itself.
 *
 * `/` used to answer with a redirect to `/study`. Nothing was wrong with that
 * on a desktop browser, but the first thing anybody arriving from a link got
 * was a round trip that moved them somewhere else before a single pixel — and
 * inside iOS's in-app browser, which is how a link opened from a home-screen
 * shortcut arrives, that redirect on the very first navigation is a known way
 * to get a page that reloads itself instead of settling.
 *
 * So the root renders the list rather than pointing at it. `/study` still
 * renders the same screen — it is a real address people have bookmarked and
 * linked to, and it stays one.
 */
export { default } from './study/page'
