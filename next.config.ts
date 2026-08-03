import type { NextConfig } from 'next'

import { PANEL_ORIGINS_FOR_CSP } from './src/panelOrigins'

/**
 * iframe Custom UI sayfaları panel tarafından çerçevelenir.
 * `frame-ancestors` origin'leri AÇIKÇA listelemek zorundadır — wildcard, 'none' ya da
 * eksik origin sürüm onayında reddedilir (§4.4).
 */
const FRAME_ANCESTORS = `frame-ancestors ${PANEL_ORIGINS_FOR_CSP.join(' ')}`

/** Custom UI'nin yaşadığı yol öneki — CSP yalnız buraya uygulanır. */
const UI_PATH_PATTERN = '/settings/:path*'

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: UI_PATH_PATTERN,
        headers: [
          // X-Frame-Options KONMAZ — frame-ancestors ile çakışır ve panel iframe'ini kırar.
          { key: 'Content-Security-Policy', value: FRAME_ANCESTORS },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
}

export default nextConfig
