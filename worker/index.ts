/**
 * Worker giriş noktası.
 *
 * OpenNext yalnız `fetch` üreten bir worker çıkarır (`.open-next/worker.js`).
 * `scheduled` (cron) ve `queue` (tüketici) handler'ları için onu SARMALARIZ:
 * fetch aynen devredilir, diğer ikisi burada bağlanır.
 *
 * `export *` OpenNext'in Durable Object sınıflarını yeniden dışa verir —
 * kaybolurlarsa deploy başarısız olur.
 */
// @ts-expect-error — build çıktısı, tip bildirimi yok
import openNext from '../.open-next/worker.js'
// @ts-expect-error — build çıktısı, tip bildirimi yok
export * from '../.open-next/worker.js'

import { buildContainer } from '../src/lib/container'
import type { Bindings } from '../src/lib/bindings'
import { runQueueBatch, runScheduledMaintenance, type QueueBatch } from '../src/worker/handlers'

interface FetchHandler {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
}

const nextHandler = openNext as FetchHandler

const handler = {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    return nextHandler.fetch(request, env, ctx)
  },

  /** Cron tetikleyicisi — bakım işleri (dedup budama). */
  scheduled(_controller: unknown, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // 🔴 Binding'ler AÇIKÇA geçilir: bu handler Next.js istek bağlamının dışındadır,
    // `getCloudflareContext()` burada çalışmaz.
    ctx.waitUntil(runScheduledMaintenance(env))
  },

  /** Kuyruk tüketicisi — dayanıklı olay işleme. */
  queue(batch: QueueBatch, env: Bindings): Promise<void> {
    const container = buildContainer({ bindings: env })
    return runQueueBatch(batch, (event) => container.webhooks.process(event))
  },
}

export default handler
