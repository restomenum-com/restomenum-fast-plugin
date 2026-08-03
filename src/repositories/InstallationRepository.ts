import type { Installation } from '@/models/Installation'
import type { TenantRef } from '@/models/TenantRef'

/**
 * Kurulum kayıtlarının veri erişim sözleşmesi.
 * SQL yalnız somut implementasyonlarda yaşar (§2.2).
 */
export interface InstallationRepository {
  /** Ortam + tenant ile TAM eşleşme. Webhook/action/hook yollarında bu kullanılır. */
  findByRef(ref: TenantRef): Promise<Installation | null>


  /** İdempotent yazma — interaktif transaction yoktur (§6). */
  upsert(installation: Installation): Promise<void>

  /** Kurulum kaldırıldığında o ORTAMDAKİ tenant kaydı silinir (§4.1). */
  deleteByRef(ref: TenantRef): Promise<void>
}
