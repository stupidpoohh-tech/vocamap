import { SignJWT, jwtVerify } from 'jose'
import type { Direction } from './scheduler'
import type { QuestionKind } from './questions'

/**
 * What the server remembers about a question it asked.
 *
 * The study screen used to grade itself: it compared the tapped option with the
 * answer it had been handed, and posted `correct: true|false` for the server to
 * write down. Every part of that is the client's word — a page can post
 * `correct: true` for a word it was never asked, as often as it likes, and the
 * schedule that is supposed to measure what this person can recall records it.
 *
 * So the answer stops travelling as a claim and travels as a signed statement
 * of what was asked. The client posts back the token and the option it chose;
 * the server compares them itself. Nothing about the grade is taken from the
 * request body.
 *
 * Signed rather than stored because a question is worth nothing after it is
 * answered: a row per question asked would be a table the size of the event log
 * that exists only to be looked up once. The signature does the same job.
 */
export type QuestionClaims = {
  /** Who it was issued to. A token minted for one reader is useless to another. */
  userId: string
  vocabularyId: string
  direction: Direction
  kind: QuestionKind
  /** The correct option, in full. The server grades against this and nothing else. */
  answer: string
  /** Every option offered, so a client cannot invent one and be marked right. */
  options: string[]
  /**
   * This particular asking of it.
   *
   * Carried into `review_events.submission_id`, where a unique index makes a
   * resent answer land exactly once. A new question gets a new id, so a student
   * who deliberately answers the same word again is a second submission and is
   * recorded as one.
   */
  submissionId: string
  /**
   * Which map the question was built from, when it was built from one. Lets a
   * later reader of the event log tell an answer about content that has since
   * been rewritten from one about the current text.
   */
  contentVersion?: number | null
}

const ISSUER = 'vocamap/question'

/**
 * Two hours. Long enough for a student to leave a test open over a meal, short
 * enough that a token lifted from a page is not a permanent licence to post
 * correct answers for that word.
 */
const TTL_SECONDS = 2 * 60 * 60

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters.')
  }
  return new TextEncoder().encode(value)
}

export async function signQuestion(claims: QuestionClaims): Promise<string> {
  return new SignJWT({
    vid: claims.vocabularyId,
    dir: claims.direction,
    knd: claims.kind,
    ans: claims.answer,
    opt: claims.options,
    sid: claims.submissionId,
    ver: claims.contentVersion ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret())
}

/**
 * Reads a token back, or null for anything that is not one this server issued
 * and is still valid. Callers treat null as "no question was asked", not as a
 * wrong answer — a submission we cannot account for is not something to write
 * into somebody's learning record.
 */
export async function verifyQuestion(token: string): Promise<QuestionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER })
    const options = payload.opt
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.vid !== 'string' ||
      typeof payload.ans !== 'string' ||
      typeof payload.sid !== 'string' ||
      !Array.isArray(options) ||
      !options.every((o): o is string => typeof o === 'string')
    ) {
      return null
    }
    const direction = payload.dir
    if (direction !== 'en_ko' && direction !== 'ko_en') return null

    return {
      userId: payload.sub,
      vocabularyId: payload.vid,
      direction,
      kind: payload.knd as QuestionKind,
      answer: payload.ans,
      options,
      submissionId: payload.sid,
      contentVersion: typeof payload.ver === 'number' ? payload.ver : null,
    }
  } catch {
    return null
  }
}

/**
 * The server's own verdict.
 *
 * An option that was never offered is not a wrong answer — it is a submission
 * that does not correspond to the question, and saying "wrong" would write a
 * lapse into the schedule on the strength of a made-up request. It comes back
 * as `offered: false` and the caller declines to record anything.
 */
export function grade(claims: QuestionClaims, choice: string): { offered: boolean; correct: boolean } {
  const offered = claims.options.includes(choice)
  return { offered, correct: offered && choice === claims.answer }
}

/**
 * How long the answer took, as far as it can be trusted.
 *
 * The number comes from the reader's own clock and can be anything at all. It
 * is kept because a plausible one is useful and a wrong one is harmless here —
 * nothing schedules on it — but an implausible one is stored as unknown rather
 * than as a measurement. Under a quarter second is faster than the tap that
 * produced it; over ten minutes is a page that was left open.
 */
const MIN_RESPONSE_MS = 250
const MAX_RESPONSE_MS = 10 * 60 * 1000

export function plausibleResponseTime(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < MIN_RESPONSE_MS || value > MAX_RESPONSE_MS) return null
  return Math.round(value)
}
