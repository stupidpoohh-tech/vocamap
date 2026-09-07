/**
 * How the importer spreads its writes.
 *
 * Pure — no database, no `server-only` — so the shape of the work is testable
 * on its own, which is the whole reason it is not inlined in the importer.
 */

/**
 * How many words are written at once.
 *
 * Each word costs about seventeen round trips: find it, insert it, its
 * glosses, then the map's head and every part of it inside a transaction. Done
 * one after another, fifty words is eight hundred and fifty round trips in
 * series — under a second against a database on the same machine, and most of
 * a minute against one three network hops away, which is what the teacher was
 * staring at.
 *
 * Nothing about one word depends on another, so that wait is pure latency and
 * overlapping it is the whole fix. The width is the connection pool's, not a
 * guess: the pool holds ten and each word's write takes one for the length of
 * its transaction, so asking for more does not go faster — the extra queries
 * would wait on the client instead of on the database. One is left over for
 * whatever else the request is doing.
 *
 * Measured on the real 50-word range: the deepest connection went from 854
 * statements to 117.
 */
export const WRITE_CONCURRENCY = 8

/**
 * Runs `work` over `items` a batch at a time, keeping the results in the order
 * the items came in — the batches finish out of order, the set must not.
 */
export async function inBatches<T, R>(
  items: T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += width) {
    results.push(...(await Promise.all(items.slice(i, i + width).map(work))))
  }
  return results
}
