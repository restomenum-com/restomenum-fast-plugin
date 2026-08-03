import type { Installation } from '@/models/Installation'
import type { InstallationRepository } from '@/repositories/InstallationRepository'
import type { EventLogRepository } from '@/repositories/EventLogRepository'

/**
 * YALNIZ TEST İÇİN bellek içi repository'ler.
 *
 * 🔴 Üretimde KULLANILMAZ. Örnek başına durum tutarlar; container istek başına
 * kurulduğu için üretimde her istek boş bir depo görür (§2.5 ihlali olmaz ama
 * hiçbir şey kalıcı olmaz). Gerçek implementasyon veritabanı seçimiyle gelir (§6).
 */

export class MemoryInstallationRepository implements InstallationRepository {
  readonly #rows = new Map<string, Installation>()

  async findByTenantId(tenantId: string): Promise<Installation | null> {
    return this.#rows.get(tenantId) ?? null
  }

  async upsert(installation: Installation): Promise<void> {
    this.#rows.set(installation.tenantId, installation)
  }

  async deleteByTenantId(tenantId: string): Promise<void> {
    this.#rows.delete(tenantId)
  }
}

export class MemoryEventLogRepository implements EventLogRepository {
  readonly #seen = new Set<string>()

  #key(tenantId: string, eventId: string): string {
    return `${tenantId}:${eventId}`
  }

  async markSeen(tenantId: string, eventId: string): Promise<boolean> {
    const key = this.#key(tenantId, eventId)
    if (this.#seen.has(key)) return false
    this.#seen.add(key)
    return true
  }

  async release(tenantId: string, eventId: string): Promise<void> {
    this.#seen.delete(this.#key(tenantId, eventId))
  }
}
