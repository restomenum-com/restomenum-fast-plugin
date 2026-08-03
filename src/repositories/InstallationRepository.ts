import type { Installation } from '@/models/Installation'
import { ConfigError } from '@/lib/errors'

/**
 * Kurulum kayıtlarının veri erişim sözleşmesi.
 * SQL yalnız bu katmandaki somut implementasyonlarda yaşar (§2.2).
 *
 * Somut Drizzle implementasyonu veritabanı seçimiyle birlikte gelir (§6):
 * dialect kararı verilmeden `pgTable`/`sqliteTable` şeması yazılamaz.
 */
export interface InstallationRepository {
  /** Tenant'ın kurulumunu getirir; kurulu değilse null. */
  findByTenantId(tenantId: string): Promise<Installation | null>

  /**
   * Kurulumu yazar. Aynı tenant için tekrar çağrılabilir olmalı —
   * neon-http ve D1'de interaktif transaction yok, idempotent upsert şart (§6).
   */
  upsert(installation: Installation): Promise<void>

  /** Kurulum kaldırıldığında tenant'a ait her şey silinir (§4.1). */
  deleteByTenantId(tenantId: string): Promise<void>
}

/**
 * Veritabanı seçilene kadar kullanılan yer tutucu.
 * Sessizce çalışıp veri kaybetmek yerine AÇIKÇA 503 verir (§2.6 — sessiz bozulma yasak).
 */
export class UnconfiguredInstallationRepository implements InstallationRepository {
  private fail(): never {
    throw new ConfigError(
      'Veritabanı seçilmedi: InstallationRepository implementasyonu bağlanmalı (CLAUDE.md §6).',
    )
  }

  findByTenantId(): Promise<Installation | null> {
    this.fail()
  }

  upsert(): Promise<void> {
    this.fail()
  }

  deleteByTenantId(): Promise<void> {
    this.fail()
  }
}
