import {
  exchangeCode,
  ApiError,
  OAuthError,
  RestomenumClient,
  type Environment,
  type InstallCredentials,
} from '@restomenum/plugin-sdk'

import { UnauthorizedError, UpstreamError } from '@/lib/errors'
import { withRetry, type RetryOptions } from '@/lib/retry'

/** 429 ve 5xx geçicidir; diğer 4xx tekrar denense de aynı sonucu verir. */
const RETRYABLE_STATUS_MIN = 500
const TOO_MANY_REQUESTS = 429

/**
 * Restomenum platformuna tek geçiş noktası.
 * SDK bu sınıfın ARKASINDA kalır; `ApiError`/`OAuthError` servis katmanına sızmaz (§2.2).
 *
 * 🔴 Ortam çağrı BAŞINA verilir, örnek başına DEĞİL. Sandbox ve production ayrı API
 * köklerine sahiptir; tek bir ortama sabitlenmiş adapter, diğer ortamın isteklerini
 * yanlış adrese gönderir.
 */
export class RestomenumAdapter {
  readonly #pluginId: string
  readonly #clientSecret: string
  readonly #retry: Pick<RetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'sleep' | 'random'>

  constructor(params: {
    pluginId: string
    clientSecret: string
    /** Test'te zaman ve jitter sabitlenir. */
    retry?: Pick<RetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'sleep' | 'random'>
  }) {
    this.#pluginId = params.pluginId
    this.#clientSecret = params.clientSecret
    this.#retry = params.retry ?? {}
  }

  /** Tek kullanımlık `code`'u belirtilen ORTAMDA kurulum credential'larına çevirir. */
  async exchangeInstallCode(code: string, environment: Environment): Promise<InstallCredentials> {
    try {
      return await exchangeCode(
        { code, clientId: this.#pluginId, clientSecret: this.#clientSecret },
        { environment },
      )
    } catch (error) {
      if (error instanceof OAuthError) {
        if (error.code === 'invalid_grant' || error.code === 'invalid_client') {
          throw new UnauthorizedError('Kurulum kodu geçersiz veya süresi dolmuş.')
        }
        throw new UpstreamError(`Token değişimi başarısız: ${error.code ?? 'bilinmeyen'}`, {
          retryable: true,
        })
      }
      throw error
    }
  }

  /** Tenant'ın apiKey'i ile o ORTAMIN Callback API istemcisini kurar. */
  clientFor(apiKey: string, environment: Environment): RestomenumClient {
    return new RestomenumClient({ apiKey, environment })
  }

  /**
   * Callback API çağrılarını sarar: `ApiError` domain hatasına çevrilir ve
   * geçici hatalarda **jitter'lı exponential backoff** ile yeniden denenir.
   * `Retry-After` geldiğinde ona uyulur (§2.6).
   */
  async call<T>(operation: () => Promise<T>): Promise<T> {
    return withRetry(() => this.#callOnce(operation), {
      ...this.#retry,
      isRetryable: (error) => error instanceof UpstreamError && error.retryable,
      retryAfterSeconds: (error) =>
        error instanceof UpstreamError ? error.retryAfterSeconds : undefined,
    })
  }

  async #callOnce<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 403) {
          throw new UnauthorizedError('Platform yetkilendirmeyi reddetti.')
        }
        throw new UpstreamError(`Platform ${error.status} döndü (${error.code ?? 'kodsuz'})`, {
          ...(error.retryAfterSec !== undefined ? { retryAfterSeconds: error.retryAfterSec } : {}),
          retryable: error.status === TOO_MANY_REQUESTS || error.status >= RETRYABLE_STATUS_MIN,
        })
      }
      throw error
    }
  }
}
