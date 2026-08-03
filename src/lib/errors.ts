/**
 * Uygulama hataları ve TEK merkezli HTTP yanıt üretimi.
 * Uçlar kendi hata formatını uydurmaz — hepsi `toErrorResponse` kullanır (§2.5).
 */

export abstract class AppError extends Error {
  abstract readonly status: number
  /** İstemciye dönen makine-okur kod. */
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Yapılandırma eksik/geçersiz → hizmet veremiyoruz, ama isteğin kendisi geçerli. */
export class ConfigError extends AppError {
  readonly status = 503
  readonly code = 'not_configured'
}

/** İmza, session token ya da state doğrulaması başarısız. */
export class UnauthorizedError extends AppError {
  readonly status = 401
  readonly code = 'unauthorized'
}

/** Kimlik doğrulandı ama bu kaynağa yetki yok. */
export class ForbiddenError extends AppError {
  readonly status = 403
  readonly code = 'forbidden'
}

/** Gövde/parametre şema doğrulamasını geçemedi. */
export class ValidationError extends AppError {
  readonly status = 400
  readonly code = 'invalid_request'
}

/** Beklenen kayıt yok (ör. kurulu olmayan tenant). */
export class NotFoundError extends AppError {
  readonly status = 404
  readonly code = 'not_found'
}

/** Yukarı akış (Restomenum ya da dış servis) hata döndü. */
export class UpstreamError extends AppError {
  readonly status = 502
  readonly code = 'upstream_error'
  readonly retryAfterSeconds: number | undefined
  /** Geçici mi? 429 ve 5xx yeniden denenir; diğer 4xx denenmez (aynı sonucu verir). */
  readonly retryable: boolean

  constructor(message: string, options: { retryAfterSeconds?: number; retryable?: boolean } = {}) {
    super(message)
    this.retryAfterSeconds = options.retryAfterSeconds
    this.retryable = options.retryable ?? false
  }
}

interface ErrorBody {
  readonly error: string
  readonly message: string
}

/** Log'a düşerken gövdeyi değil yalnız sınıf + mesajı yaz — PII/secret sızdırma. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return 'bilinmeyen hata'
}

/**
 * Herhangi bir hatayı kanonik HTTP yanıtına çevirir.
 * Bilinmeyen hatalar 500'e düşer ve ayrıntısı istemciye SIZMAZ.
 */
export function toErrorResponse(error: unknown, logPrefix: string): Response {
  if (error instanceof AppError) {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (error instanceof UpstreamError && error.retryAfterSeconds !== undefined) {
      headers.set('retry-after', String(error.retryAfterSeconds))
    }
    // 4xx beklenen akış; yalnız 5xx gürültü sayılır.
    if (error.status >= 500) console.error(`${logPrefix} ${describe(error)}`)
    const body: ErrorBody = { error: error.code, message: error.message }
    return new Response(JSON.stringify(body), { status: error.status, headers })
  }

  console.error(`${logPrefix} beklenmeyen hata — ${describe(error)}`)
  const body: ErrorBody = { error: 'internal_error', message: 'Beklenmeyen bir hata oluştu.' }
  return new Response(JSON.stringify(body), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
}
