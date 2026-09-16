import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { SESSION_COOKIE } from '@/lib/auth/cookie'

/**
 * Sends a signed-out request to the sign-in page before anything renders.
 *
 * Only for the screens that are about *you*. Reading what a tutor published —
 * the word list, the maps, a single word — needs no account, so those routes
 * are not matched here and render for a guest. See `getViewer`.
 *
 * The guard used to live at the top of the app layout, which meant the layout
 * had to await a database round trip before it could return any markup — and
 * with it, the loading skeleton of whatever page was opening. Moving the guard
 * here lets the layout be synchronous and stream immediately, without giving up
 * the clean redirect: a signed-out visitor still gets a 307 from the edge
 * rather than a flash of skeleton and a client-side bounce.
 *
 * This only checks that the cookie is a token we signed. Whether the session is
 * still valid — not revoked, not expired — is `getActor`'s job, and every page
 * still calls it. A stolen or stale token gets past this and no further.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (token && (await isOurs(token))) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

async function isOurs(token: string): Promise<boolean> {
  const value = process.env.AUTH_SECRET
  // Without a secret nothing can be verified; let the request through and let
  // the page's own `requireActor` refuse it, rather than locking everyone out
  // of a misconfigured deployment with no way to see why.
  if (!value || value.length < 32) return true
  try {
    await jwtVerify(token, new TextEncoder().encode(value))
    return true
  } catch {
    return false
  }
}

export const config = {
  matcher: ['/vault/:path*', '/teacher/:path*', '/admin/:path*'],
}
