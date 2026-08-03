'use client'

import { PANEL_ORIGINS } from '@restomenum/plugin-sdk'

/**
 * App Bridge istemci köprüsü (yalnız tarayıcı).
 *
 * Protokol (get_catalog → appBridge):
 *   istek : { type: 'restomenum-bridge',          requestId, action, params }
 *   yanıt : { type: 'restomenum-bridge-response', requestId, result: { success, data?, message? } }
 *
 * 🔴 `targetOrigin` PİNLENİR — wildcard '*' yasak; gelen mesajda `event.origin`
 * allowlist'e karşı doğrulanır. Parent origin `document.referrer` ile TESPİT EDİLEMEZ
 * (iframe `referrerPolicy="no-referrer"` ile yüklenir), bu yüzden liste sabittir (§4.4).
 */

const REQUEST_TYPE = 'restomenum-bridge'
const RESPONSE_TYPE = 'restomenum-bridge-response'

/** Anlık yanıtlanan action'lar için üst sınır. */
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Kullanıcı etkileşimi bekleyen action'lar — panel bunlarda onay dialogu açar.
 * 🔴 Bunlara TIMEOUT KONMAZ: kullanıcı dialogu okurken zaman aşımı tetiklenir ve
 * gerçek yanıt geldiğinde dinleyici çoktan kaldırılmış olur (dokümante yasak).
 */
const INTERACTIVE_ACTIONS: ReadonlySet<string> = new Set(['openUrl', 'resolve', 'submit', 'close'])

interface BridgeResult<T> {
  readonly success: boolean
  readonly data?: T
  readonly message?: string
}

interface BridgeResponseMessage<T> {
  readonly type: string
  readonly requestId: string
  readonly result?: BridgeResult<T>
}

function isAllowedOrigin(origin: string): boolean {
  return (PANEL_ORIGINS as readonly string[]).includes(origin)
}

/**
 * Sayfa bir üst pencere içinde mi (panel iframe'i)?
 * Doğrudan tarayıcıda açıldığında false döner — çağıran, hata göstermek yerine
 * panel dışı bir görünüm sunabilir.
 */
export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

/** Panele bir komut gönderip yanıtı bekler. */
export function bridgeCall<T>(action: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === 'undefined' || window.parent === window) {
      reject(new Error('App Bridge yalnız panel iframe içinde kullanılabilir.'))
      return
    }

    const requestId = crypto.randomUUID()
    const isInteractive = INTERACTIVE_ACTIONS.has(action)

    let timer: ReturnType<typeof setTimeout> | undefined
    if (!isInteractive) {
      timer = setTimeout(() => {
        window.removeEventListener('message', onMessage)
        reject(new Error(`App Bridge zaman aşımı: ${action}`))
      }, DEFAULT_TIMEOUT_MS)
    }

    function finish(): void {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }

    function onMessage(event: MessageEvent<unknown>): void {
      // 🔴 Gelen her mesajın origin'i doğrulanır — aksi halde herhangi bir sayfa yanıt uydurabilir.
      if (!isAllowedOrigin(event.origin)) return

      const message = event.data as BridgeResponseMessage<T> | null
      if (message === null || typeof message !== 'object') return
      if (message.type !== RESPONSE_TYPE || message.requestId !== requestId) return

      finish()

      const result = message.result
      if (result === undefined || !result.success) {
        reject(new Error(result?.message ?? `App Bridge hatası: ${action}`))
        return
      }
      resolve(result.data as T)
    }

    window.addEventListener('message', onMessage)

    // Hangi panelden yüklendiğimizi bilemeyiz; her PİNLENMİŞ origin'e gönderilir.
    // targetOrigin eşleşmeyen postMessage tarayıcı tarafından teslim edilmez —
    // mesajı yalnız gerçek panel alır.
    for (const origin of PANEL_ORIGINS) {
      window.parent.postMessage({ type: REQUEST_TYPE, requestId, action, params }, origin)
    }
  })
}

interface SessionTokenResult {
  readonly token: string
  readonly tokenType: string
  readonly expiresIn: number
}

interface ContextResult {
  readonly serverId: string
  readonly pluginId: string
  readonly locale: string
  readonly refId?: string
}

/**
 * Kısa ömürlü session token alır (TTL 120 sn).
 * 🔴 CACHE'LENMEZ — fetch'ten hemen önce alınır; sunucu `exp`'i her çağrıda doğrular (§4.3).
 */
export async function getSessionToken(): Promise<string> {
  const result = await bridgeCall<SessionTokenResult>('getSessionToken')
  return result.token
}

/** Panel bağlamı — tenant (serverId), locale ve gate hedefi (refId). */
export function getContext(): Promise<ContextResult> {
  return bridgeCall<ContextResult>('getContext')
}

/**
 * Dış adrese gitmenin TEK yolu.
 * `window.open` ve `<a target="_blank">` iframe sandbox'ında çalışmaz.
 * Panel önce kullanıcıya onay dialogu gösterir → timeout YOK.
 */
export function openUrl(url: string): Promise<{ opened: boolean }> {
  return bridgeCall<{ opened: boolean }>('openUrl', { url })
}

/** iframe yüksekliğini panele bildirir. */
export function resize(height: number): Promise<void> {
  return bridgeCall<void>('resize', { height })
}

/** Backend çağrısı için üst sınır — asılı kalan istek iframe'i süresiz "yükleniyor"da bırakır. */
const API_TIMEOUT_MS = 15_000

/**
 * Session token'lı fetch — iframe'den backend'e giden tüm istekler bunu kullanır.
 * Çağıran kendi `signal`'ini verirse ona dokunulmaz.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken()
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  const signal = init.signal ?? AbortSignal.timeout(API_TIMEOUT_MS)
  return fetch(path, { ...init, headers, signal })
}
