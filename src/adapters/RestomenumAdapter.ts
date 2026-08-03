import {
  exchangeCode,
  ApiError,
  OAuthError,
  RestomenumClient,
  type Environment,
  type InstallCredentials,
} from '@restomenum/plugin-sdk'

import { UnauthorizedError, UpstreamError } from '@/lib/errors'

/**
 * Restomenum platformuna tek geçiş noktası.
 * SDK bu sınıfın ARKASINDA kalır; `ApiError`/`OAuthError` servis katmanına sızmaz,
 * adapter kendi domain hatasına çevirir (§2.2, §4.5).
 */
export class RestomenumAdapter {
  readonly #environment: Environment
  readonly #pluginId: string
  readonly #clientSecret: string

  constructor(params: { environment: Environment; pluginId: string; clientSecret: string }) {
    this.#environment = params.environment
    this.#pluginId = params.pluginId
    this.#clientSecret = params.clientSecret
  }

  /** Connect dönüşündeki tek kullanımlık `code`'u kurulum credential'larına çevirir. */
  async exchangeInstallCode(code: string): Promise<InstallCredentials> {
    try {
      return await exchangeCode(
        { code, clientId: this.#pluginId, clientSecret: this.#clientSecret },
        { environment: this.#environment },
      )
    } catch (error) {
      if (error instanceof OAuthError) {
        // invalid_grant: code kullanılmış ya da süresi geçmiş → Connect baştan başlar.
        if (error.code === 'invalid_grant' || error.code === 'invalid_client') {
          throw new UnauthorizedError('Kurulum kodu geçersiz veya süresi dolmuş.')
        }
        throw new UpstreamError(`Token değişimi başarısız: ${error.code ?? 'bilinmeyen'}`)
      }
      throw error
    }
  }

  /** Tenant'ın apiKey'i ile Callback API istemcisi kurar. */
  clientFor(apiKey: string): RestomenumClient {
    return new RestomenumClient({ apiKey, environment: this.#environment })
  }

  /**
   * Callback API çağrılarını sarar: `ApiError` domain hatasına çevrilir,
   * 429'da `Retry-After` korunur (§4.2).
   */
  async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 403) {
          throw new UnauthorizedError('Platform yetkilendirmeyi reddetti.')
        }
        throw new UpstreamError(
          `Platform ${error.status} döndü (${error.code ?? 'kodsuz'})`,
          error.retryAfterSec,
        )
      }
      throw error
    }
  }
}
