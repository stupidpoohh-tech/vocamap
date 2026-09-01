import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Voca Brain Map',
  description: '암기는 반복하고, 이해가 필요한 단어는 연결한다.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Learning screens are text-heavy; never block the student from zooming.
  maximumScale: 5,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
