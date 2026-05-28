import { renderAppIcon } from '@/lib/app-icon'

// Next.js File Convention: serves this as /apple-icon (PNG) and emits
// the <link rel="apple-touch-icon"> tag. 180×180 is the size iOS uses
// for home-screen icons on modern iPhones.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return renderAppIcon(180)
}
