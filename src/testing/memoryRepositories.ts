import type { Installation } from '@/models/Installation'
import { type TenantRef, tenantKey } from '@/models/TenantRef'
import type { InstallationRepository } from '@/repositories/InstallationRepository'
import type { EventLogRepository } from '@/repositories/EventLogRepository'

/**
 * YALNIZ TEST İÇİN bellek içi repository'ler.
 * 🔴 Üretimde KULLANILMAZ. Gerçek implementasyon `D1*Repository` sınıflarıdır.
 *
 * D1 ile aynı anahtarlama kuralını uygular: kayıtlar ORTAM + tenant ile anahtarlanır.
 * Aksi halde testler, üretimde var olan cross-environment ezilmesini yakalayamazdı.
 */

export class MemoryInstallationRepository implements InstallationRepository {
  readonly #rows = new Map<string, Installation>()

  async findByRef(ref: TenantRef): Promise<Installation | null> {
    return this.#rows.get(tenantKey(ref)) ?? null
  }


  async upsert(installation: Installation): Promise<void> {
    this.#rows.set(tenantKey(installation.ref), installation)
  }

  async deleteByRef(ref: TenantRef): Promise<void> {
    this.#rows.delete(tenantKey(ref))
  }
}

export class MemoryEventLogRepository implements EventLogRepository {
  readonly #seen = new Map<string, number>()
  readonly #now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.#now = now
  }

  #key(ref: TenantRef, eventId: string): string {
    return `${tenantKey(ref)}:${eventId}`
  }

  async markSeen(ref: TenantRef, eventId: string): Promise<boolean> {
    const key = this.#key(ref, eventId)
    if (this.#seen.has(key)) return false
    this.#seen.set(key, this.#now())
    return true
  }

  async pruneSeenBefore(cutoffMs: number, limit: number): Promise<number> {
    let removed = 0
    for (const [key, seenAt] of this.#seen) {
      if (removed >= limit) break
      if (seenAt < cutoffMs) {
        this.#seen.delete(key)
        removed++
      }
    }
    return removed
  }

  async release(ref: TenantRef, eventId: string): Promise<void> {
    this.#seen.delete(this.#key(ref, eventId))
  }
}
