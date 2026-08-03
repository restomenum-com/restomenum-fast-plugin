import {
  verifyAndParseWebhook,
  type Environment,
  type EventType,
  type LifecycleType,
  type WebhookEnvelope,
} from '@restomenum/plugin-sdk'

import type { InstallationService } from '@/services/InstallationService'
import type { EventLogRepository } from '@/repositories/EventLogRepository'
import type { TenantRef } from '@/models/TenantRef'
import { SIGNATURE_TOLERANCE_SEC } from '@/config'
import { UnauthorizedError, ValidationError } from '@/lib/errors'

/**
 * İşleyici kaydedilebilen olay adları.
 *
 * SDK iki AYRI birleşim verir: iş olayları (`EventType`) ve kurulum yaşam döngüsü
 * (`LifecycleType`). İkisi de gelir, ikisine de işleyici yazılabilir.
 *
 * 🔴 Bu tipin varlık sebebi: uydurma olay adını DERLEME ZAMANINDA yakalamak.
 * `'plugin.uninstalled'` gibi bir yazım hatası çalışma anında sessizce eşleşmez —
 * olay hiç işlenmez, tenant verisi silinmez ve hata görünmez.
 */
export type HandledEventType = EventType | LifecycleType

/**
 * Kurulum yaşam döngüsü olayları.
 * Tip bildirimi ZORUNLU — yanlış ad yazılırsa derleyici durdurur.
 */
const LIFECYCLE_UNINSTALL: LifecycleType = 'app.uninstalled'
/** KVKK/GDPR silme talebi — müşteri verisi tutuluyorsa BURADA temizlenmelidir. */
const LIFECYCLE_REDACT: LifecycleType = 'customer.redact'

export type EventHandler = (envelope: WebhookEnvelope, ref: TenantRef) => Promise<void>

/** Doğrulanmış zarf + ortam — servis dışına bu çift taşınır. */
export interface VerifiedEvent {
  readonly envelope: WebhookEnvelope
  readonly ref: TenantRef
}

/**
 * Webhook doğrulama, tekilleştirme ve yönlendirme.
 * Ağır iş bu sınıfın DIŞINDA, `waitUntil` ile çalışır — handler 2xx'i bekletmez (§4.2).
 */
export class WebhookService {
  readonly #installations: InstallationService
  readonly #eventLog: EventLogRepository
  readonly #handlers: ReadonlyMap<HandledEventType, EventHandler>

  constructor(params: {
    installations: InstallationService
    eventLog: EventLogRepository
    /** Olay adları tip düzeyinde kısıtlıdır — yazım hatası derlenmez. */
    handlers?: ReadonlyMap<HandledEventType, EventHandler>
  }) {
    this.#installations = params.installations
    this.#eventLog = params.eventLog
    this.#handlers = params.handlers ?? new Map()
  }

  /**
   * İmzayı HAM gövde üzerinden doğrular ve zarfı çözer.
   *
   * Ortam gövdeden okunur; `X-Restomenum-Environment` header'ı İMZAYA DAHİL DEĞİLDİR
   * ve kullanılmaz. Ortam imza anahtarını seçmek için imzadan ÖNCE okunmak zorundadır —
   * yalan söylenirse yanlış secret seçilir ve imza tutmaz, yani güvenli.
   */
  async verify(rawBody: string, signatureHeader: string | null): Promise<VerifiedEvent> {
    let unverified: unknown
    try {
      unverified = JSON.parse(rawBody)
    } catch {
      throw new ValidationError('Gövde geçerli JSON değil.')
    }

    // 🔴 Ortam İSTEKTEN okunur, yapılandırmadan DEĞİL. Eksikse tahmin edilmez:
    // yanlış ortam varsayımı credential'ı yanlış anahtara yazar ve sonraki tüm
    // teslimler sessizce 401 olur. Fail-closed.
    const environment = readEnvironment(unverified)
    if (environment === undefined) {
      throw new ValidationError('Gövdede `environment` alanı yok.')
    }
    let ref: TenantRef | undefined
    let installationFound = false

    const envelope = await verifyAndParseWebhook(rawBody, signatureHeader ?? undefined, {
      toleranceSec: SIGNATURE_TOLERANCE_SEC,
      getSecret: async (tenantId) => {
        ref = { environment, tenantId }
        const secret = await this.#installations.webhookSecretFor(ref)
        installationFound = secret !== undefined
        return secret
      },
    })

    if (envelope === null || ref === undefined) {
      // Teslim sağlığını ayırt edilebilir kıl: kurulum mu yok, imza mı tutmuyor?
      // İkisi de 401 döner ama nedenleri ve çözümleri tamamen farklıdır.
      const reason = installationFound
        ? 'imza uyuşmuyor (eski secret ya da oynanmış gövde)'
        : 'bu ortamda kurulum yok'
      console.log(`webhook: reddedildi env=${environment} neden=${reason}`)
      throw new UnauthorizedError('Webhook imzası geçersiz.')
    }
    return { envelope, ref }
  }

  /**
   * Olayı tam bir kez işler.
   * İş başarısız olursa sahiplenme geri verilir — aksi halde geçici bir hata olayı
   * kalıcı olarak kaybettirirdi (retry'lar dedup'a takılır).
   */
  async process(event: VerifiedEvent): Promise<void> {
    const { envelope, ref } = event
    const isNew = await this.#eventLog.markSeen(ref, envelope.id)
    if (!isNew) {
      console.log(`webhook: yinelenen olay atlandı type=${envelope.type} env=${ref.environment}`)
      return
    }

    try {
      await this.#dispatch(event)
    } catch (error) {
      await this.#eventLog.release(ref, envelope.id)
      throw error
    }
  }

  async #dispatch({ envelope, ref }: VerifiedEvent): Promise<void> {
    if (envelope.type === LIFECYCLE_UNINSTALL) {
      await this.#installations.removeInstall(ref)
      console.log(`webhook: kurulum kaldırıldı env=${ref.environment}`)
      return
    }

    if (envelope.type === LIFECYCLE_REDACT) {
      // Eklenti müşteri verisi tutmaya başladığında burası doldurulmak ZORUNDA.
      console.log('webhook: customer.redact alındı — silinecek kalıcı müşteri verisi yok')
      return
    }

    // `envelope.type` ağdan gelen bir string; aramada daraltma yapılır. Tip güvenliği
    // KAYIT tarafında sağlanır — kimse tanınmayan bir ada işleyici bağlayamaz.
    const handler = this.#handlers.get(envelope.type as HandledEventType)
    if (handler === undefined) {
      console.log(`webhook: işleyicisiz olay type=${envelope.type} env=${ref.environment}`)
      return
    }

    await handler(envelope, ref)
  }
}

/** Doğrulanmamış gövdeden yalnız ortam alanını okur; tanınmayan değer yok sayılır. */
export function readEnvironment(body: unknown): Environment | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as { environment?: unknown }).environment
  return value === 'sandbox' || value === 'production' ? value : undefined
}
