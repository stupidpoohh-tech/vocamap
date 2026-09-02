'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/session'
import { toggleBookmark } from '@/lib/data/study'

/**
 * Adds or removes a word from the signed-in person's study list.
 *
 * The user id comes from the session, never from the client, so bookmarking
 * can only ever affect your own list.
 */
export async function setBookmark(vocabularyId: string, bookmarked: boolean): Promise<void> {
  const actor = await requireActor()
  await toggleBookmark({ userId: actor.id, vocabularyId, bookmarked })
  revalidatePath('/words')
  revalidatePath('/study')
  revalidatePath(`/words/${vocabularyId}`)
}
