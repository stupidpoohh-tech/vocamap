import { NextResponse, type NextRequest } from 'next/server'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { SESSION_COOKIE } from '@/lib/auth/cookie'
import {
  PATH_HEADER,
  RENEW_WHEN_LEFT_UNDER_DAYS,
  SESSION_DAYS,
  SIGNED_OUT,
} from '@/lib/auth/lifetime'

/**
 * Two jobs, both at the edge, before anything renders.
 *
 * **Sends a signed-out request to the sign-in page.** Only for the screens that
 * are about *you*. Reading what a tutor published — the word list, the maps, a
 * single word — needs no account, so those routes render for a guest. See
 * `getViewer` and `GUARDED` below.
 *
 * The guard used to live at the top of the app layout, which meant the layout
 * had to await a database round trip before it could return any markup — and
 * with it, the loading skeleton of whatever page was opening. Moving it here
 * lets the layout be synchronous and stream immediately, without giving up the
 * clean redirect: a signed-out visitor still gets a 307 from the edge rather
 * than a flash of skeleton and a client-side bounce.
 *
 * **Pushes a valid session's expiry back.** The cookie, the token in it and the
 * `sessions` row were all stamped thirty days from the moment you signed in and
 * never touched again, so someone who opened the app daily was signed out on
 * day thirty anyway. This renews the cookie and the token; `getActor` renews
 * the row. Renewal runs on every screen, guarded or not, because the screen
 * people actually live on — the word list — is a public one.
 *
 * This only checks that the cookie is a token we signed. Whether the session is
 * still valid — not revoked, not expired — is `getActor`'s job, and every page
 * still calls it. A stolen or stale token gets past this and no further.
 */

/** The screens that are about you. Everything else reads without an account. */
const GUARDED = ['/vault', '/teacher', '/admin', '/account']

export async function middleware(request: NextRequest) {
  const guarded = GUARDED.some(
    (path) =>
      request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`),
  )

  // Every request carries its own path onwards, so a page that decides to
  // bounce can say where the reader was. See `PATH_HEADER`.
  const forward = () => {
    const headers = new Headers(request.headers)
    headers.set(PATH_HEADER, request.nextUrl.pathname)
    return NextResponse.next({ request: { headers } })
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return guarded ? bounce(request, 'session') : forward()

  const claims = await ours(token)
  // Unreadable and unrenewable, but not necessarily wrong: without a secret
  // nothing can be verified, and locking everyone out of a misconfigured
  // deployment with no way to see why is worse than letting the page's own
  // `requireActor` refuse it.
  if (claims === 'unverifiable') return forward()
  if (!claims) return guarded ? bounce(request, 'invalid') : forward()

  const response = forward()
  await renew(response, claims)
  return response
}

/**
 * Re-signs the cookie when it is close enough to expiring to be worth it.
 *
 * Same `sid`, so it still points at the same row and revoking it still works;
 * only the deadline moves. A failure is silent on purpose — the cookie in hand
 * is still valid, and refusing the request over a renewal would turn a small
 * problem into the exact logout this exists to prevent.
 */
async function renew(response: NextResponse, claims: JWTPayload): Promise<void> {
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  if (exp - Date.now() >= RENEW_WHEN_LEFT_UNDER_DAYS * 86_400_000) return

  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) return

  try {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
    const token = await new SignJWT({ sid: claims.sid, uid: claims.uid, role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(value))

    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    })
  } catch (error) {
    console.error('[middleware:renew]', error)
  }
}

/** To the sign-in screen, saying why, and remembering where they were. */
function bounce(request: NextRequest, reason: 'session' | 'invalid') {
  const url = request.nextUrl.clone()
  const here = request.nextUrl.pathname
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set(SIGNED_OUT, reason)
  url.searchParams.set('next', here)
  return NextResponse.redirect(url)
}

async function ours(token: string): Promise<JWTPayload | null | 'unverifiable'> {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) return 'unverifiable'
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(value))
    return payload
  } catch {
    return null
  }
}

export const config = {
  // Everything but the framework's own assets. Renewal has to reach the public
  // screens too, so the matcher can no longer be the guarded list; `GUARDED`
  // decides who gets redirected, and this decides who gets looked at.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
