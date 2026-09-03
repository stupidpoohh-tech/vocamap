/**
 * The id a signed-out visitor reads the app as.
 *
 * Every per-person query joins on a user id — saved words, review history, the
 * state of each map node. A visitor with no account has none of that, and the
 * honest way to say so to the database is an id that cannot match a row: the
 * nil UUID, which `gen_random_uuid()` never produces. Reads then return exactly
 * what is true for a guest, with no second code path to keep in step.
 *
 * Nothing is ever written under it. Writes take an `Actor`, and the only way to
 * get one is `requireActor`, which a guest never satisfies.
 *
 * Its own module, like the cookie name: `session.ts` is `server-only`, and this
 * is a plain constant the data layer and its tests both need.
 */
export const GUEST_ID = '00000000-0000-0000-0000-000000000000'
