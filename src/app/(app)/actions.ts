'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/session'
import { toggleBookmark } from '@/lib/data/study'

/**
 * Adds or removes a word from the signed-in person's saved list.
 *
 * The user id comes from the session, never from the client, so saving can only
 * ever affect your own list. Lives here rather than under one route because the
 * star appears on all three student screens.
 */
export async function setBookmark(vocabularyId: string, bookmarked: boolean): Promise<void> {
  const actor = await requireActor()
  await toggleBookmark({ userId: actor.id, vocabularyId, bookmarked })
  revalidatePath('/study')
  revalidatePath('/vault')
  revalidatePath('/map')
  revalidatePath(`/words/${vocabularyId}`)
}
