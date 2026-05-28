import { ImageResponse } from 'next/og'

/**
 * Renders the Aspatuck home-screen icon as a PNG at the requested square
 * size. Used by both src/app/icon.tsx (512×512, manifest icon) and
 * src/app/apple-icon.tsx (180×180, iOS touch icon).
 *
 * Design: tennis-ball optic-yellow background, two thin white seam
 * curves suggesting the classic ball pattern, and a bold green "AT"
 * monogram centered on top. We leave ~10% safe-zone padding so the
 * Android maskable variant doesn't clip the monogram when the OS
 * crops the square into a circle/squircle.
 */
export function renderAppIcon(size: number): ImageResponse {
  // Font + stroke scale linearly with the icon size so the 180×180
  // apple-icon looks identical to the 512×512 manifest icon.
  const fontSize = Math.round(size * 0.5)
  const strokeWidth = Math.max(2, Math.round(size * 0.028))

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: '#d4e94e',
          position: 'relative',
        }}
      >
        {/* Tennis-ball seam: two arcs spaced above/below the AT so they
            frame the monogram rather than cutting through it. Drawn in
            viewBox space (0–512) and stretched to the icon size. */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 512 512"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <path
            d="M 0 120 C 140 200, 372 200, 512 120"
            stroke="white"
            strokeWidth={(strokeWidth * 512) / size}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 0 392 C 140 312, 372 312, 512 392"
            stroke="white"
            strokeWidth={(strokeWidth * 512) / size}
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        <div
          style={{
            display: 'flex',
            position: 'relative',
            fontFamily: 'sans-serif',
            fontWeight: 900,
            fontSize,
            color: '#15803d',
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          AT
        </div>
      </div>
    ),
    { width: size, height: size },
  )
}
