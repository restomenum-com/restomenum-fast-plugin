import { ENCRYPTION_KEY_BYTES } from '@/config'
import { ConfigError, UnauthorizedError } from '@/lib/errors'

/**
 * At-rest şifreleme ve imzalı state.
 * Web Crypto kullanır — workerd'de `node:crypto` olmadan da çalışır.
 */

const CIPHER_ALGORITHM = 'AES-GCM'
const IV_BYTES = 12
const HMAC_HASH = 'SHA-256'
const STATE_SEPARATOR = '.'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Sabit zamanlı karşılaştırma — imza/secret eşitliği `===` ile yapılmaz. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  // Uzunluk farkı erken dönüşle sızmasın diye sabit uzunlukta gezilir.
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

async function importCipherKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64Url(base64Key.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''))
  if (raw.length !== ENCRYPTION_KEY_BYTES) {
    throw new ConfigError(
      `SECRET_ENCRYPTION_KEY ${ENCRYPTION_KEY_BYTES} bayt olmalı (base64), ${raw.length} bayt geldi.`,
    )
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, CIPHER_ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Düz metni şifreler → `base64url(iv):base64url(ciphertext)`. */
export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importCipherKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: CIPHER_ALGORITHM, iv },
    key,
    encoder.encode(plaintext) as BufferSource,
  )
  return `${toBase64Url(iv)}${STATE_SEPARATOR}${toBase64Url(new Uint8Array(ciphertext))}`
}

/** `encryptSecret` çıktısını çözer. Bozuk/oynanmış veri AES-GCM tarafından reddedilir. */
export async function decryptSecret(payload: string, base64Key: string): Promise<string> {
  const [ivPart, cipherPart] = payload.split(STATE_SEPARATOR)
  if (ivPart === undefined || cipherPart === undefined) {
    throw new ConfigError('Şifreli değer bozuk: beklenen biçim iv.ciphertext')
  }
  const key = await importCipherKey(base64Key)
  const plaintext = await crypto.subtle.decrypt(
    { name: CIPHER_ALGORITHM, iv: fromBase64Url(ivPart) as BufferSource },
    key,
    fromBase64Url(cipherPart) as BufferSource,
  )
  return decoder.decode(plaintext)
}

async function importHmacKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(base64Key) as BufferSource,
    { name: 'HMAC', hash: HMAC_HASH },
    false,
    ['sign'],
  )
}

async function hmac(message: string, base64Key: string): Promise<string> {
  const key = await importHmacKey(base64Key)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message) as BufferSource)
  return toBase64Url(new Uint8Array(signature))
}

/**
 * Connect akışı için imzalı, durumsuz `state` üretir (CSRF).
 * Sunucuda nonce saklamaya gerek kalmaz — imza + zaman damgası yeterli.
 */
export async function createSignedState(issuedAtSeconds: number, secret: string): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const payload = `${issuedAtSeconds}${STATE_SEPARATOR}${nonce}`
  return `${payload}${STATE_SEPARATOR}${await hmac(payload, secret)}`
}

/** İmzalı state'i doğrular; imza tutmuyorsa ya da süresi geçtiyse hata fırlatır. */
export async function verifySignedState(
  state: string,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number,
): Promise<void> {
  const parts = state.split(STATE_SEPARATOR)
  const [issuedAt, nonce, signature] = parts
  if (parts.length !== 3 || issuedAt === undefined || nonce === undefined || signature === undefined) {
    throw new UnauthorizedError('state biçimi geçersiz')
  }

  const expected = await hmac(`${issuedAt}${STATE_SEPARATOR}${nonce}`, secret)
  if (!timingSafeEqual(expected, signature)) {
    throw new UnauthorizedError('state imzası geçersiz')
  }

  const issuedAtSeconds = Number(issuedAt)
  if (!Number.isFinite(issuedAtSeconds) || nowSeconds - issuedAtSeconds > ttlSeconds) {
    throw new UnauthorizedError('state süresi dolmuş')
  }
}
