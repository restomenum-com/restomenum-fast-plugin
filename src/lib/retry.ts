/**
 * Dış çağrılar için yeniden deneme.
 *
 * Sektör standardı **full jitter** kullanılır: bekleme süresi
 * `random() * min(maxDelay, base * 2^deneme)`.
 * Sabit ya da yalnız üstel gecikme, aynı anda 429 yiyen tüm isteklerin aynı anda
 * yeniden denemesine yol açar (thundering herd) — jitter bunu dağıtır.
 *
 * `Retry-After` geldiğinde ona UYULUR; sunucunun söylediği süre tahminimizden iyidir.
 */

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 8_000
const MILLISECONDS_PER_SECOND = 1000

export interface RetryOptions {
  /** Toplam deneme sayısı (ilk çağrı dahil). */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Test'te zamanı sabitlemek için enjekte edilir. */
  sleep?: (ms: number) => Promise<void>
  /** Test'te jitter'ı sabitlemek için enjekte edilir. */
  random?: () => number
  /** Bu hata yeniden denenebilir mi? */
  isRetryable: (error: unknown) => boolean
  /** Sunucunun önerdiği bekleme (saniye) — varsa jitter yerine bu kullanılır. */
  retryAfterSeconds?: (error: unknown) => number | undefined
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bir sonraki denemeden önce beklenecek süre. */
export function computeDelayMs(
  attempt: number,
  options: { baseDelayMs: number; maxDelayMs: number; random: () => number },
): number {
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt)
  return Math.floor(options.random() * exponential)
}

/**
 * İşlemi başarılı olana ya da denemeler bitene kadar tekrarlar.
 * Yeniden denenemez hata ANINDA fırlatılır — boşuna bekleme yapılmaz.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt === maxAttempts - 1
      if (isLastAttempt || !options.isRetryable(error)) throw error

      const suggested = options.retryAfterSeconds?.(error)
      const delayMs =
        suggested !== undefined
          ? Math.min(maxDelayMs, suggested * MILLISECONDS_PER_SECOND)
          : computeDelayMs(attempt, { baseDelayMs, maxDelayMs, random })

      console.log(`429: yeniden deneme ${attempt + 1}/${maxAttempts - 1} — ${delayMs}ms sonra`)
      await sleep(delayMs)
    }
  }
  throw lastError
}
