import { renderAppIcon } from '@/lib/app-icon'

// Next.js File Convention: serves this as /icon (PNG) and references it
// from the manifest. 512×512 is the standard PWA primary icon size.
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return renderAppIcon(512)
}
