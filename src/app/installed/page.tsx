import { PANEL_PATH_HINT, PLUGIN_DISPLAY_NAME, PLUGIN_TAGLINE } from '@/branding'

/**
 * Kurulum sonrası sayfası — ÜST PENCEREDE açılır (OAuth akışı iframe'de dönmez).
 *
 * 🔴 Burada App Bridge KULLANILMAZ: üst pencere panel değildir, `getSessionToken`
 * kaçınılmaz olarak başarısız olur. Panele özgü her şey `/settings` sayfasına aittir.
 */

/** Kurulumdan sonra kullanıcının izleyeceği adımlar. */
const NEXT_STEPS = [
  { title: 'Panele dön', detail: 'Restomenum panelinizi açık olan sekmede yeniden ziyaret edin.' },
  {
    title: 'Eklentiyi aç',
    detail: `${PANEL_PATH_HINT} → ${PLUGIN_DISPLAY_NAME} bölümüne girin.`,
  },
  { title: 'Ayarları yap', detail: 'Eklentinin nasıl çalışacağını buradan belirleyin.' },
] as const

export default function InstalledPage() {
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-6 py-16">
      {/* Arka plan: statik, dikkat dağıtmayan yumuşak ışıma */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_-10%,var(--color-brand-50),transparent)] dark:bg-[radial-gradient(60rem_40rem_at_50%_-10%,oklch(0.28_0.06_155),transparent)]"
      />

      <div className="w-full max-w-lg">
        <div className="rounded-[var(--radius-panel)] border border-slate-200/80 bg-white/80 p-8 shadow-xl shadow-slate-900/5 backdrop-blur-xl sm:p-10 dark:border-white/10 dark:bg-white/5 dark:shadow-black/40">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-200">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.5}
              stroke="currentColor"
              className="size-7"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>

          <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Kurulum tamamlandı
          </h1>
          <p className="mt-3 text-pretty text-base leading-relaxed text-slate-600 dark:text-slate-300">
            {PLUGIN_TAGLINE}
          </p>

          <ol className="mt-8 space-y-4">
            {NEXT_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-8 border-t border-slate-200/80 pt-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
            Bu sekmeyi güvenle kapatabilirsiniz.
          </p>
        </div>
      </div>
    </main>
  )
}
