import {
  verifySessionToken,
  SessionError,
  type Environment,
  type SessionTokenClaims,
} from '@restomenum/plugin-sdk'

import type { InstallationService } from '@/services/InstallationService'
import type { TenantRef } from '@/models/TenantRef'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'

/** Panel rolleri — yetki kararları bu claim'e dayanır, istemciden gelen değere değil. */
export const ROLE_MANAGER = 'manager'

/** Doğrulanmış oturum: claim'ler + kurulumun tam kimliği. */
export interface Session {
  readonly claims: SessionTokenClaims
  readonly ref: TenantRef
}

/**
 * Token gövdesini İMZA DOĞRULAMADAN okur.
 *
 * Yalnız imza anahtarını SEÇMEK için kullanılır. Buradan okunan değere GÜVENİLMEZ:
 * yalan söylenirse yanlış secret seçilir ve imza tutmaz. Webhook yolundaki desenin aynısı.
 */
function peekEnvironment(authorizationHeader: string | null): Environment | undefined {
  if (authorizationHeader === null) return undefined
  const payload = authorizationHeader.replace(/^Bearer\s+/i, '').split('.')[1]
  if (payload === undefined) return undefined

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return undefined
    const value = (decoded as { environment?: unknown }).environment
    return value === 'sandbox' || value === 'production' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * iframe'den gelen isteklerin kimliklendirilmesi.
 * `aud === pluginId` kontrolü SDK içinde ZORUNLU olarak yapılır (§4.3).
 */
export class SessionService {
  readonly #installations: InstallationService
  readonly #pluginId: string
  constructor(params: {
    installations: InstallationService
    pluginId: string
  }) {
    this.#installations = params.installations
    this.#pluginId = params.pluginId
  }

  /**
   * Authorization header'ını doğrular → güvenilir claim'ler + kurulum kimliği.
   * Bundan sonra `tenantId`, `role` ve `environment` YALNIZ doğrulanmış claim'lerden okunur.
   */
  async authenticate(authorizationHeader: string | null): Promise<Session> {
    // Ortam token claim'inden okunur; eksikse tahmin edilmez (fail-closed).
    const environment = peekEnvironment(authorizationHeader)
    if (environment === undefined) {
      throw new UnauthorizedError('Oturum belirteci geçersiz.')
    }
    let ref: TenantRef | undefined

    try {
      const claims = await verifySessionToken(authorizationHeader, {
        pluginId: this.#pluginId,
        getSecret: (tenantId) => {
          ref = { environment, tenantId }
          return this.#installations.webhookSecretFor(ref)
        },
      })

      if (ref === undefined) {
        throw new UnauthorizedError('Oturum belirteci geçersiz.')
      }

      // Savunma katmanı: imza doğrulandıktan sonra, anahtar seçiminde kullandığımız
      // ortamın imzalanmış claim ile aynı olduğunu teyit et.
      const claimed = claims['environment']
      if (typeof claimed === 'string' && claimed !== environment) {
        console.log('session: ortam claim uyuşmazlığı — reddedildi')
        throw new UnauthorizedError('Oturum belirteci geçersiz.')
      }

      return { claims, ref }
    } catch (error) {
      if (error instanceof SessionError) {
        // Neden log'lanır, istemciye ayrıntı verilmez.
        console.log(`session: token reddedildi reason=${error.reason}`)
        throw new UnauthorizedError('Oturum belirteci geçersiz.')
      }
      throw error
    }
  }

  /** Yalnız yöneticinin yapabileceği işlemler için. */
  requireManager(claims: SessionTokenClaims): void {
    if (claims.role !== ROLE_MANAGER) {
      throw new ForbiddenError('Bu işlem için yönetici yetkisi gerekiyor.')
    }
  }
}
