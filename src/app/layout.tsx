import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'

import '@/app/globals.css'

/**
 * Yazı tipi `next/font` ile derleme anında indirilip KENDİ ORIGIN'İMİZDEN sunulur.
 * Böylece çalışma anında dış istek olmaz — CSP ve Worker alt-istek bütçesi korunur.
 */
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' })

export const metadata = {
  title: 'Restomenum Eklentisi',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="font-sans bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  )
}
