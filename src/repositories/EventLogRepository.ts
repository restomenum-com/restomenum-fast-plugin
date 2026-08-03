import { ConfigError } from '@/lib/errors'

/**
 * Olay tekilleştirme (dedup) sözleşmesi.
 * Teslim at-least-once'tır ve sırasızdır → aynı `eventId` birden çok kez gelebilir (§4.2).
 */
export interface EventLogRepository {
  /**
   * Olayı sahiplenmeye çalışır: ilk kez görülüyorsa true, zaten işlendiyse false.
   * ATOMİK olmalı — iki eşzamanlı teslim ikisi de true alamaz.
   * Karşılığı: `INSERT ... ON CONFLICT DO NOTHING` + etkilenen satır sayısı.
   */
  markSeen(tenantId: string, eventId: string): Promise<boolean>

  /**
   * Sahiplenmeyi geri verir (işleme başarısız oldu).
   * Bu olmadan geçici bir hata olayı KALICI olarak kaybettirir: kayıt "görüldü" kalır,
   * platformun retry'ları dedup'a takılır ve iş hiç yapılmaz.
   */
  release(tenantId: string, eventId: string): Promise<void>
}

/** Veritabanı seçilene kadar açık hata verir — sessizce "yeni olay" demek çift işlem üretirdi. */
export class UnconfiguredEventLogRepository implements EventLogRepository {
  private fail(): never {
    throw new ConfigError(
      'Veritabanı seçilmedi: EventLogRepository implementasyonu bağlanmalı (CLAUDE.md §6).',
    )
  }

  markSeen(): Promise<boolean> {
    this.fail()
  }

  release(): Promise<void> {
    this.fail()
  }
}
