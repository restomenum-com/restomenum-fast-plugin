'use client'

import { useEffect, useState } from 'react'

import { apiFetch, isEmbedded } from '@/lib/appBridge'
import { PANEL_PATH_HINT, PLUGIN_DISPLAY_NAME } from '@/branding'

/**
 * iframe Custom UI — panel bu sayfayı çerçeveler.
 * CSP `frame-ancestors` header'ı `next.config.ts` içinde bu yola uygulanır (§4.4).
 *
 * Panel açık ya da koyu temada çerçeveleyebilir; ikisi de desteklenir.
 * Sayfa doğrudan tarayıcıda açıldığında App Bridge yoktur — bu bir hata değil,
 * beklenen durumdur ve ayrı bir görünümle karşılanır.
 */

interface SessionInfo {
  readonly user: { readonly id: string; readonly role: string }
  readonly installation: { readonly tenantId: string; readonly scopes: readonly string[] }
}

type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'standalone' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly session: SessionInfo }

const SHELL = 'min-h-dvh px-6 py-10 sm:px-8'
const CARD =
  'rounded-[var(--radius-panel)] border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-white/5'

export default function SettingsPage() {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      // Panel dışında açıldıysa session token alınamaz — nedenini açıkça göster.
      if (!isEmbedded()) {
        if (!cancelled) setView({ kind: 'standalone' })
        return
      }

      try {
        const response = await apiFetch('/api/session/me')
        if (!response.ok) {
          throw new Error(`Oturum doğrulanamadı (HTTP ${response.status})`)
        }
        const session = (await response.json()) as SessionInfo
        if (!cancelled) setView({ kind: 'ready', session })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Bilinmeyen hata'
        if (!cancelled) setView({ kind: 'error', message })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (view.kind === 'loading') {
    return (
      <main className={SHELL}>
        <div className="mx-auto max-w-2xl space-y-4" aria-busy>
          <div className="h-7 w-56 animate-pulse rounded-lg bg-slate-200 dark:bg-white/10" />
          <div className="h-36 animate-pulse rounded-[var(--radius-panel)] bg-slate-100 dark:bg-white/5" />
        </div>
      </main>
    )
  }

  if (view.kind === 'standalone') {
    return (
      <main className={SHELL}>
        <div className={`mx-auto max-w-2xl ${CARD}`}>
          <h1 className="text-2xl font-semibold tracking-tight">{PLUGIN_DISPLAY_NAME}</h1>
          <p className="mt-3 text-pretty leading-relaxed text-slate-600 dark:text-slate-300">
            Bu ekran Restomenum paneli içinde çalışır ve doğrudan açıldığında oturum bilgisine
            erişemez.
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Panelden{' '}
            <strong className="font-medium">
              {PANEL_PATH_HINT} → {PLUGIN_DISPLAY_NAME}
            </strong>{' '}
            yolunu izleyin.
          </p>
        </div>
      </main>
    )
  }

  if (view.kind === 'error') {
    return (
      <main className={SHELL}>
        <div
          role="alert"
          className={`mx-auto max-w-2xl ${CARD} border-red-200/80 dark:border-red-400/20`}
        >
          <h1 className="text-2xl font-semibold tracking-tight">Bir sorun oluştu</h1>
          <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">{view.message}</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Sayfayı yenilemeyi deneyin; sorun sürerse eklentiyi yeniden kurun.
          </p>
        </div>
      </main>
    )
  }

  const { session } = view
  return (
    <main className={SHELL}>
      <div className="mx-auto max-w-2xl">
        <header>
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Eklenti Ayarları
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Bağlı işletme ve verilen yetkiler.
          </p>
        </header>

        <dl className={`mt-6 ${CARD} grid gap-6 sm:grid-cols-2`}>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Kullanıcı
            </dt>
            <dd className="mt-1 font-medium break-all">{session.user.id}</dd>
            <dd className="mt-1">
              <span className="inline-flex items-center rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-500/20 dark:text-brand-200">
                {session.user.role}
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              İşletme
            </dt>
            <dd className="mt-1 font-mono text-sm break-all">{session.installation.tenantId}</dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Verilen yetkiler
            </dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {session.installation.scopes.length === 0 ? (
                <span className="text-sm text-slate-500 dark:text-slate-400">Yetki verilmemiş</span>
              ) : (
                session.installation.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-700 dark:bg-white/10 dark:text-slate-200"
                  >
                    {scope}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
