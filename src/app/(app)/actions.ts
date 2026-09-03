'use server'

import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/session'
import { toggleBookmark } from '@/lib/data/study'
import { NEEDS_LOGIN, WROTE, type WriteResult } from '@/lib/auth/write-result'

/**
 * Adds or removes a word from the signed-in person's saved list.
 *
 * The user id comes from the session, never from the client, so saving can only
 * ever affect your own list. Lives here rather than under one route because the
 * star appears on all three student screens.
 *
 * A guest gets `needsLogin` rather than a redirect. Keeping a word is the first
 * thing on this product that needs an account, and the button that asked for it
 * knows where the reader was — a redirect thrown from here would land them back
 * on the app's front door having lost the word they were looking at.
 */
export async function setBookmark(
  vocabularyId: string,
  bookmarked: boolean,
): Promise<WriteResult> {
  const actor = await getActor()
  if (!actor) return NEEDS_LOGIN

  await toggleBookmark({ userId: actor.id, vocabularyId, bookmarked })
  revalidatePath('/study')
  revalidatePath('/vault')
  revalidatePath('/map')
  revalidatePath(`/words/${vocabularyId}`)
  return WROTE
}
