import { redirect } from 'next/navigation'

/**
 * There is no front page.
 *
 * A marketing page in front of the product is a door you have to open before
 * you can look at anything, and everything it described is one screen further
 * in. The root goes straight to the word list — signed in or not.
 */
export default function Home() {
  redirect('/study')
}
