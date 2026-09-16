import bcrypt from 'bcryptjs'

const ROUNDS = 11

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new Error('Password must be at least 8 characters.')
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * The alphabet a temporary password is drawn from.
 *
 * No `0/O`, no `1/l/I`: this password is read out loud or copied off a screen
 * by hand, and a character that two people can disagree about turns a reset
 * into a support conversation. Lower case only, for the same reason — the
 * person typing it should not have to wonder about shift.
 */
const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * A one-off password an admin hands to someone who cannot sign in.
 *
 * Twelve characters from a 31-symbol alphabet is a little over 59 bits, which
 * is far more than this needs — the password is meant to be replaced within
 * minutes, and the account is sent to the change screen until it is. Grouped
 * in fours so it can be read aloud without losing your place.
 */
export function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => READABLE[b % READABLE.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-')
}
