import bcrypt from 'bcryptjs'

const ROUNDS = 11

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new Error('Password must be at least 8 characters.')
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
