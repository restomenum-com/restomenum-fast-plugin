import type { ReactNode } from 'react'

export const metadata = {
  title: 'Restomenum Eklentisi',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  )
}
