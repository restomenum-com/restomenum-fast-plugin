import { and, eq, inArray, lt } from 'drizzle-orm'

import type { Database } from '@/db/client'
import { seenEvents } from '@/db/schema'
import type { TenantRef } from '@/models/TenantRef'
import type { EventLogRepository } from '@/repositories/EventLogRepository'

/** Dedup kaydının D1 implementasyonu. */
export class D1EventLogRepository implements EventLogRepository {
  readonly #db: Database
  readonly #now: () => number

  constructor(db: Database, now: () => number = () => Date.now()) {
    this.#db = db
    this.#now = now
  }

  /**
   * Olayı sahiplenir. ATOMİK: `INSERT ... ON CONFLICT DO NOTHING` sonucu
   * etkilenen satır sayısına bakar — iki eşzamanlı teslim ikisi de true alamaz.
   */
  async markSeen(ref: TenantRef, eventId: string): Promise<boolean> {
    const result = await this.#db
      .insert(seenEvents)
      .values({
        environment: ref.environment,
        tenantId: ref.tenantId,
        eventId,
        seenAt: this.#now(),
      })
      .onConflictDoNothing()

    return (result.meta?.changes ?? 0) > 0
  }

  /**
   * Eski dedup kayıtlarını partiler halinde siler.
   * `limit` ile sınırlanır — tek sorguda milyonlarca satır silmek D1'i kilitler.
   */
  async pruneSeenBefore(cutoffMs: number, limit: number): Promise<number> {
    const stale = await this.#db
      .select({ environment: seenEvents.environment, tenantId: seenEvents.tenantId, eventId: seenEvents.eventId })
      .from(seenEvents)
      .where(lt(seenEvents.seenAt, cutoffMs))
      .limit(limit)

    if (stale.length === 0) return 0

    // neon-http ve D1'de interaktif transaction yok → batch ile atomik olmayan ama
    // idempotent silme (§6). Yeniden çalıştırmak zararsızdır.
    await this.#db.delete(seenEvents).where(
      and(
        lt(seenEvents.seenAt, cutoffMs),
        inArray(
          seenEvents.eventId,
          stale.map((row) => row.eventId),
        ),
      ),
    )
    return stale.length
  }

  /** İşleme başarısız oldu → sahiplenmeyi geri ver ki platform retry'ı yeniden denesin. */
  async release(ref: TenantRef, eventId: string): Promise<void> {
    await this.#db
      .delete(seenEvents)
      .where(
        and(
          eq(seenEvents.environment, ref.environment),
          eq(seenEvents.tenantId, ref.tenantId),
          eq(seenEvents.eventId, eventId),
        ),
      )
  }
}
