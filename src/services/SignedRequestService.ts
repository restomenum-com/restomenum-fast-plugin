import { verifyWebhookSignature } from '@restomenum/plugin-sdk'
import type { ZodType } from 'zod'

import type { InstallationService } from '@/services/InstallationService'
import { readEnvironment } from '@/services/WebhookService'
import type { TenantRef } from '@/models/TenantRef'
import { SIGNATURE_TOLERANCE_SEC } from '@/config'
import { UnauthorizedError, ValidationError } from '@/lib/errors'

/**
 * Senkron imzalı isteklerin (action, hook, capability) ortak doğrulaması.
 * Action ve hook uçları aynı şemayı paylaşır — mantık tek yerde yaşar (§2.3).
 */

const SIGNATURE_HEADER = 'x-restomenum-signature'

interface TenantScoped {
  readonly tenantId: string
}

function readTenantId(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Gövde bir nesne değil.')
  }
  const tenantId = (body as { tenantId?: unknown }).tenantId
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new ValidationError('tenantId eksik.')
  }
  return tenantId
}

export class SignedRequestService {
  readonly #installations: InstallationService
  constructor(params: { installations: InstallationService }) {
    this.#installations = params.installations
  }

  /**
   * İmzayı HAM gövde üzerinden doğrular, sonra gövdeyi şemayla parse eder.
   *
   * `tenantId` ve `environment` imza anahtarını SEÇMEK için imzadan önce okunur, ama
   * doğrulanmamış hiçbir alan iş mantığında kullanılmaz — sahte değerler yanlış secret
   * seçtirir ve imza tutmaz.
   */
  async verify<T extends TenantScoped>(
    request: Request,
    schema: ZodType<T>,
  ): Promise<{ body: T; ref: TenantRef; rawBody: string }> {
    const rawBody = await request.text()

    let unverified: unknown
    try {
      unverified = JSON.parse(rawBody)
    } catch {
      throw new ValidationError('Gövde geçerli JSON değil.')
    }

    // Ortam istekten okunur; eksikse tahmin edilmez (fail-closed).
    const environment = readEnvironment(unverified)
    if (environment === undefined) {
      throw new ValidationError('Gövdede `environment` alanı yok.')
    }
    const ref: TenantRef = { environment, tenantId: readTenantId(unverified) }

    const secret = await this.#installations.webhookSecretFor(ref)
    if (secret === undefined) {
      // Kurulu olmayan tenant ile imza doğrulanamaz — 401, kurulum durumunu sızdırmaz.
      throw new UnauthorizedError('İstek doğrulanamadı.')
    }

    const isValid = verifyWebhookSignature(
      rawBody,
      request.headers.get(SIGNATURE_HEADER) ?? undefined,
      secret,
      { toleranceSec: SIGNATURE_TOLERANCE_SEC },
    )
    if (!isValid) {
      throw new UnauthorizedError('İstek doğrulanamadı.')
    }

    const parsed = schema.safeParse(unverified)
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
      throw new ValidationError(`Gövde şemaya uymuyor: ${fields}`)
    }

    return { body: parsed.data, ref, rawBody }
  }
}
