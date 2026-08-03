import { buildContainer } from '@/lib/container'
import type { Bindings } from '@/lib/bindings'
import type { VerifiedEvent } from '@/services/WebhookService'

/**
 * `fetch` DIŞINDAKİ handler'ların iş mantığı.
 * Worker giriş dosyası ince tutulur; asıl iş burada, test edilebilir biçimde durur (§2.2).
 */

/** Kuyruk mesajının gereken yüzeyi — Cloudflare tipine bağımlılık kurmadan. */
export interface QueueMessage {
  readonly body: unknown
  ack(): void
  retry(): void
}

export interface QueueBatch {
  readonly messages: readonly QueueMessage[]
}

/** Cron: süresi dolmuş dedup kayıtlarını budar. */
export async function runScheduledMaintenance(bindings: Bindings): Promise<void> {
  const container = buildContainer({ bindings })
  await container.maintenance.pruneSeenEvents()
}

/**
 * Kuyruk tüketicisi.
 *
 * Her mesaj TEK TEK ack/retry edilir — biri hata verdiğinde tüm partiyi geri almak,
 * başarılı olanları da yeniden işletir ve dedup'a gereksiz yük bindirir.
 * Kalıcı hatada kuyruğun kendi retry/DLQ mekanizması devreye girer.
 */
export async function runQueueBatch(
  batch: QueueBatch,
  process: (event: VerifiedEvent) => Promise<void>,
): Promise<void> {
  for (const message of batch.messages) {
    const event = message.body as VerifiedEvent
    try {
      await process(event)
      message.ack()
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'bilinmeyen'
      console.error(`kuyruk: işleme hatası type=${event?.envelope?.type} ${detail}`)
      // Dedup sahiplenmesi process() içinde geri verildi; kuyruk yeniden dener.
      message.retry()
    }
  }
}
