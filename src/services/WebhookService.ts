import { verifyAndParseWebhook, type WebhookEnvelope } from '@restomenum/plugin-sdk'

import type { InstallationService } from '@/services/InstallationService'
import type { EventLogRepository } from '@/repositories/EventLogRepository'
import { SIGNATURE_TOLERANCE_SEC } from '@/config'
import { UnauthorizedError } from '@/lib/errors'

/** Kurulum yaşam döngüsü olayları — her eklentide ele alınması gerekenler. */
const LIFECYCLE_UNINSTALL = 'plugin.uninstalled'

export type EventHandler = (envelope: WebhookEnvelope) => Promise<void>

/**
 * Webhook doğrulama, tekilleştirme ve yönlendirme.
 * Ağır iş bu sınıfın DIŞINDA, `waitUntil` ile çalışır — handler 2xx'i bekletmez (§4.2).
 */
export class WebhookService {
  readonly #installations: InstallationService
  readonly #eventLog: EventLogRepository
  readonly #handlers: ReadonlyMap<string, EventHandler>

  constructor(params: {
    installations: InstallationService
    eventLog: EventLogRepository
    /** Olay tipi → işleyici. Eklentiye özgü akışlar buradan bağlanır. */
    handlers?: ReadonlyMap<string, EventHandler>
  }) {
    this.#installations = params.installations
    this.#eventLog = params.eventLog
    this.#handlers = params.handlers ?? new Map()
  }

  /**
   * İmzayı HAM gövde üzerinden doğrular ve zarfı çözer.
   * Gövde burada parse EDİLMEZ — `request.json()` doğrulamadan önce çağrılmaz (§4.2).
   */
  async verify(rawBody: string, signatureHeader: string | null): Promise<WebhookEnvelope> {
    const envelope = await verifyAndParseWebhook(rawBody, signatureHeader ?? undefined, {
      toleranceSec: SIGNATURE_TOLERANCE_SEC,
      getSecret: (tenantId) => this.#installations.webhookSecretFor(tenantId),
    })

    if (envelope === null) {
      throw new UnauthorizedError('Webhook imzası geçersiz.')
    }
    return envelope
  }

  /**
   * Olayı tam bir kez işler.
   *
   * Sahiplenme (`markSeen`) işten ÖNCE alınır ki eşzamanlı iki teslim aynı işi yapmasın.
   * İş BAŞARISIZ olursa sahiplenme geri verilir — aksi halde geçici bir hata olayı
   * kalıcı olarak kaybettirirdi: kayıt "görüldü" kalır, platformun retry'ları dedup'a
   * takılır ve iş hiçbir zaman yapılmaz.
   */
  async process(envelope: WebhookEnvelope): Promise<void> {
    const isNew = await this.#eventLog.markSeen(envelope.tenantId, envelope.id)
    if (!isNew) {
      console.log(`webhook: yinelenen olay atlandı type=${envelope.type}`)
      return
    }

    try {
      await this.#dispatch(envelope)
    } catch (error) {
      await this.#eventLog.release(envelope.tenantId, envelope.id)
      throw error
    }
  }

  async #dispatch(envelope: WebhookEnvelope): Promise<void> {
    if (envelope.type === LIFECYCLE_UNINSTALL) {
      await this.#installations.removeInstall(envelope.tenantId)
      return
    }

    const handler = this.#handlers.get(envelope.type)
    if (handler === undefined) {
      console.log(`webhook: işleyicisiz olay type=${envelope.type}`)
      return
    }

    await handler(envelope)
  }
}
