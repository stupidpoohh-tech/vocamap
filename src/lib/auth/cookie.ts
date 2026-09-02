/**
 * The session cookie's name, on its own so the middleware can read it.
 *
 * `session.ts` is `server-only` and pulls in the database client; the middleware
 * runs on the edge and must not import either.
 */
export const SESSION_COOKIE = 'vocamap_session'
