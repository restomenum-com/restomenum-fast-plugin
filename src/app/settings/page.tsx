'use client'

import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/appBridge'

/**
 * iframe Custom UI — panel bu sayfayı çerçeveler.
 * CSP `frame-ancestors` header'ı `next.config.ts` içinde bu yola uygulanır (§4.4).
 */

interface SessionInfo {
  readonly user: { readonly id: string; readonly role: string }
  readonly installation: { readonly tenantId: string; readonly scopes: readonly string[] }
}

export default function SettingsPage() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await apiFetch('/api/session/me')
        if (!response.ok) {
          throw new Error(`Oturum doğrulanamadı (${response.status})`)
        }
        const data = (await response.json()) as SessionInfo
        if (!cancelled) setSession(data)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Bilinmeyen hata')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error !== null) {
    return <main style={{ padding: 24 }}>Hata: {error}</main>
  }

  if (session === null) {
    return <main style={{ padding: 24 }}>Yükleniyor…</main>
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Eklenti Ayarları</h1>
      <p>
        Kullanıcı: <strong>{session.user.id}</strong> ({session.user.role})
      </p>
      <p>
        Tenant: <strong>{session.installation.tenantId}</strong>
      </p>
      <p>Yetkiler: {session.installation.scopes.join(', ') || 'yok'}</p>
    </main>
  )
}
