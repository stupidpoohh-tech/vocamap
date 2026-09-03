/**
 * What a personal write tells the caller when there is no account behind it.
 *
 * Its own module because the actions that return it are `'use server'` files,
 * and those may only export async functions — a shared constant cannot live
 * beside them.
 */
export type WriteResult = { ok: true } | { ok: false; needsLogin: true }

export const NEEDS_LOGIN = { ok: false, needsLogin: true } as const
export const WROTE = { ok: true } as const
