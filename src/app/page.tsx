import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'

export default async function RootPage() {
  const actor = await getActor()
  if (!actor) redirect('/login')
  redirect(actor.role === 'student' ? '/study' : '/teacher')
}
