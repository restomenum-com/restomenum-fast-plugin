import { verifySessionToken, SessionError, type SessionTokenClaims } from '@restomenum/plugin-sdk'

import type { InstallationService } from '@/services/InstallationService'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'

/** Panel rolleri — yetki kararları bu claim'e dayanır, istemciden gelen değere değil. */
export const ROLE_MANAGER = 'manager'

/**
 * iframe'den gelen isteklerin kimliklendirilmesi.
 * `aud === pluginId` kontrolü SDK içinde ZORUNLU olarak yapılır (§4.3).
 */
export class SessionService {
  readonly #installations: InstallationService
  readonly #pluginId: string

  constructor(params: { installations: InstallationService; pluginId: string }) {
    this.#installations = params.installations
    this.#pluginId = params.pluginId
  }

  /**
   * Authorization header'ını doğrular → güvenilir claim'ler.
   * Bundan sonra `tenantId` ve `role` YALNIZ dönen claim'lerden okunur.
   */
  async authenticate(authorizationHeader: string | null): Promise<SessionTokenClaims> {
    try {
      return await verifySessionToken(authorizationHeader, {
        pluginId: this.#pluginId,
        getSecret: (tenantId) => this.#installations.webhookSecretFor(tenantId),
      })
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
