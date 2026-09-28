import { NextResponse, type NextRequest } from 'next/server'
import { reissueSessionCookie } from '@/lib/auth/session'
import { SIGNED_OUT } from '@/lib/auth/lifetime'

/**
 * Repairs a cookie whose claims have gone stale, then puts the reader back.
 *
 * A page cannot set a cookie while it renders, so the repair needs somewhere of
 * its own to happen; this is that place. It exists because an admin changing an
 * account's role left that account's browser holding the old one, and the two
 * disagreeing sent every screen to the sign-in page — which sent it straight
 * back, forever. The address never changed, so all anyone saw was a screen
 * flickering with nothing on it.
 *
 * Nothing here is taken from the caller except where to go afterwards, and that
 * only if it is a path inside this app. The claims written are the database's.
 */
export async function GET(request: NextRequest) {
  if (await reissueSessionCookie()) {
    return to(safeNext(request.nextUrl.searchParams.get('next')))
  }

  // Nothing to repair — there is no valid session behind this cookie. That is
  // the one case where the sign-in screen is the right answer, and it does not
  // bounce back, because it is told why it is showing.
  return to(`/login?${SIGNED_OUT}=session`)
}

/**
 * A redirect that names a path and nothing else.
 *
 * `NextResponse.redirect` wants an absolute URL, and the host it builds one
 * from is whatever the runtime believes it is serving — behind a proxy that is
 * not always the host the reader typed. Sending them to a different origin
 * would leave the cookie this route just wrote on the other side of it. A
 * relative `Location` is valid and cannot get that wrong.
 */
function to(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

/** A path in this app, never another site, and never back into this route. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value.startsWith('/session/') ? '/' : value
}
