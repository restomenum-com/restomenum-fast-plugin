import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * Cloudflare binding'lerine TEK erişim noktası (§5).
 * Route ve servisler `getCloudflareContext`'i doğrudan çağırmaz.
 */

export interface Bindings {
  /** wrangler.jsonc `vars` */
  readonly RESTOMENUM_PLUGIN_ID?: string
  /** `wrangler secret put` ile verilir */
  readonly RESTOMENUM_CLIENT_SECRET?: string
  readonly SECRET_ENCRYPTION_KEY?: string
  /** D1 binding'i (§6). */
  readonly DB?: unknown
  /** Cloudflare Queues producer binding'i — dayanıklı arka plan işi için. */
  readonly EVENT_QUEUE?: { send(body: unknown): Promise<void> }
}

/**
 * İstek bağlamındaki binding'ler.
 *
 * 🔴 YALNIZ `fetch` yolunda çalışır. `queue` ve `scheduled` handler'ları Next.js istek
 * bağlamının DIŞINDADIR; oralarda binding'ler handler argümanından gelir ve
 * `buildContainer({ bindings })` ile AÇIKÇA enjekte edilir.
 */
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
