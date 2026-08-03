import type { TenantRef } from '@/models/TenantRef'

/**
 * Olay tekilleştirme (dedup) sözleşmesi.
 * Teslim at-least-once'tır ve sırasızdır → aynı `eventId` birden çok kez gelebilir (§4.2).
 */
export interface EventLogRepository {
  /**
   * Olayı sahiplenmeye çalışır: ilk kez görülüyorsa true, zaten işlendiyse false.
   * ATOMİK olmalı — iki eşzamanlı teslim ikisi de true alamaz.
   */
  markSeen(ref: TenantRef, eventId: string): Promise<boolean>

  /**
   * Sahiplenmeyi geri verir (işleme başarısız oldu).
   * Bu olmadan geçici bir hata olayı KALICI olarak kaybettirir.
   */
  release(ref: TenantRef, eventId: string): Promise<void>

  /**
   * Verilen zamandan eski dedup kayıtlarını siler ve silinen satır sayısını döner.
   *
   * Dedup tablosu sürekli büyür; budanmazsa sınırsız şişer (§2.6 saklama politikası).
   * Kesme noktası, platformun retry penceresinden BELİRGİN ölçüde uzun olmalıdır —
   * erken budamak, geç gelen bir retry'ın yeniden işlenmesine yol açar.
   */
  pruneSeenBefore(cutoffMs: number, limit: number): Promise<number>
}
