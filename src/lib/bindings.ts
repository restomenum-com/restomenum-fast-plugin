import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * Cloudflare binding'lerine TEK erişim noktası (§5).
 * Route ve servisler `getCloudflareContext`'i doğrudan çağırmaz.
 */

export interface Bindings {
  /** wrangler.jsonc `vars` */
  readonly RESTOMENUM_PLUGIN_ID?: string
  readonly RESTOMENUM_ENVIRONMENT?: string
  /** `wrangler secret put` ile verilir */
  readonly RESTOMENUM_CLIENT_SECRET?: string
  readonly SECRET_ENCRYPTION_KEY?: string
  /** Veritabanı seçimi yapılınca dolar (§6) — D1 binding'i ya da Neon bağlantı dizesi. */
  readonly DB?: unknown
  readonly DATABASE_URL?: string
}

export function getBindings(): Bindings {
  return getCloudflareContext().env as unknown as Bindings
}

/**
 * İsteğin yaşam döngüsünü uzatan execution context.
 * Yanıtı geciktirmeden arka plan işi çalıştırmak için kullanılır (§4.2).
 */
export function getExecutionContext(): { waitUntil(promise: Promise<unknown>): void } {
  return getCloudflareContext().ctx
}
