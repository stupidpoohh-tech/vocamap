/**
 * How long a session lives, and when it is worth renewing.
 *
 * Its own module because the middleware needs these numbers and runs at the
 * edge, where it must not import `session.ts` — that file is `server-only` and
 * pulls in the database client. Same reason `cookie.ts` exists.
 */

/** A fresh session, and what every renewal resets it to. */
export const SESSION_DAYS = 30

/**
 * Renew once there is less than this left.
 *
 * Renewing on every request would mean re-signing a token and writing a row on
 * every page view for no gain. At this threshold somebody who opens the app
 * even once a fortnight is never signed out, and a session nobody touches
 * still lapses on its own within a month.
 */
export const RENEW_WHEN_LEFT_UNDER_DAYS = 23

/** The query parameter the sign-in screen reads to say why it is showing. */
export const SIGNED_OUT = 'signed_out'

export type SignedOutReason = 'session' | 'mismatch' | 'role' | 'expired' | 'invalid'

/**
 * The header the middleware puts the current path in.
 *
 * A Server Component cannot ask which URL it is rendering, and the bounce in
 * `readerFromCookie` needs it — otherwise signing back in lands you on the home
 * screen instead of the page you were reading. The edge knows the path and is
 * already touching every request, so it passes it along.
 */
export const PATH_HEADER = 'x-vocamap-path'
