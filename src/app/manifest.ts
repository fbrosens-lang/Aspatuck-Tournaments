import type { MetadataRoute } from 'next'

// Web app manifest, served by Next.js at /manifest.webmanifest and
// linked automatically from the document head. Lets players install
// the site as a home-screen app on iOS (Safari Share → Add to Home
// Screen) and Android (Chrome ⋮ → Install app).
//
// The icon entry points at /icon, which is the build-time-generated
// PNG defined by src/app/icon.tsx. We declare it for both 'any' and
// 'maskable' purposes so Android can crop it into any shape; the
// icon includes safe-zone padding so the crop doesn't clip the AT.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aspatuck Tournaments',
    short_name: 'Aspatuck Tournaments',
    description: 'Tennis tournament signups, draws, and results.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafaf9',
    theme_color: '#15803d',
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
