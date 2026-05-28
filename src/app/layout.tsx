import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Header } from '@/components/Header'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Aspatuck Tournaments',
  description: 'Tennis tournament signups, draws, and results.',
  // Tells iOS to launch the app in standalone mode (no Safari chrome)
  // after the user adds it to the home screen via Share → Add to Home
  // Screen. The title is what shows under the home-screen icon.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Aspatuck Tournaments',
  },
  // Legacy iOS (< 16.4) only recognizes the apple-prefixed alias.
  // Next.js's appleWebApp.capable already emits the modern standard
  // (`mobile-web-app-capable`); this adds the legacy variant so older
  // iPhones still launch the app standalone.
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
}

// Explicit viewport so iOS Safari uses the device width and doesn't
// shrink-to-fit. Next.js 16 has its own default, but being explicit
// avoids surprises when the default changes. themeColor sets the
// Android Chrome address-bar tint and the PWA install splash accent.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#15803d',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1 w-full mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  )
}
