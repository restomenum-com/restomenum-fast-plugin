import type { EventLogRepository } from '@/repositories/EventLogRepository'

/**
 * Zamanlanmış bakım işleri.
 *
 * Şu an tek iş dedup tablosunun budanması. Bu tablo her olayda büyür ve
 * budanmazsa sınırsız şişer (§2.6 saklama politikası).
 */

/**
 * Dedup kaydının saklanma süresi.
 * 🔴 Platformun retry penceresinden (en fazla ~1 saat) BELİRGİN ölçüde uzun olmalı.
 * 7 gün, gecikmiş bir teslimin bile hâlâ tekil sayılmasını garanti eder; kısa tutmak
 * geç gelen retry'ın yeniden işlenmesine yol açar.
 */
export const SEEN_EVENT_RETENTION_DAYS = 7

/** Tek çalıştırmada silinecek azami satır — D1'i uzun kilitlememek için. */
export const PRUNE_BATCH_LIMIT = 5_000

const MS_PER_DAY = 24 * 60 * 60 * 1000

export class MaintenanceService {
  readonly #eventLog: EventLogRepository
  readonly #now: () => number

  constructor(params: { eventLog: EventLogRepository; now?: () => number }) {
    this.#eventLog = params.eventLog
    this.#now = params.now ?? (() => Date.now())
  }

  /** Süresi dolmuş dedup kayıtlarını budar; silinen satır sayısını döner. */
  async pruneSeenEvents(): Promise<number> {
    const cutoffMs = this.#now() - SEEN_EVENT_RETENTION_DAYS * MS_PER_DAY
    const removed = await this.#eventLog.pruneSeenBefore(cutoffMs, PRUNE_BATCH_LIMIT)
    console.log(`bakim: ${removed} dedup kaydı budandı (${SEEN_EVENT_RETENTION_DAYS} günden eski)`)
    return removed
  }
}
