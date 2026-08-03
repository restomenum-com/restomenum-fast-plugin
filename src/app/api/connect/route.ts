import { buildContainer } from '@/lib/container'
import { CONNECT_STATE_TTL_SECONDS } from '@/config'
import { createSignedState, verifySignedState } from '@/lib/crypto'
import { UnauthorizedError, ValidationError, toErrorResponse } from '@/lib/errors'

/**
 * OAuth Connect ucu.
 *
 * - `code` yoksa: imzalı `state` üretip akışı başlatan tarafa döner (CSRF).
 * - `code` varsa: `state` doğrulanır, sunucudan sunucuya token değişimi yapılır.
 *
 * `client_secret` yalnız bu uçtan, sunucu tarafında kullanılır — istemciye asla gitmez (§4.1).
 */

const MILLISECONDS_PER_SECOND = 1000
const LOG_PREFIX = 'oauth:'

/** Kurulum bittiğinde kullanıcının döneceği panel içi yol. */
const POST_INSTALL_PATH = '/settings'

export async function GET(request: Request): Promise<Response> {
  try {
    const container = buildContainer()
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const nowSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND)

    // Akışın başı: imzalı state üret. Sunucuda nonce saklamaya gerek yok.
    if (code === null) {
      const issued = await createSignedState(nowSeconds, container.config.clientSecret)
      return Response.json({ state: issued })
    }

    if (state === null) {
      throw new ValidationError('state parametresi eksik.')
    }

    await verifySignedState(
      state,
      container.config.clientSecret,
      nowSeconds,
      CONNECT_STATE_TTL_SECONDS,
    )

    const installation = await container.installations.completeInstall(code)
    console.log(`${LOG_PREFIX} kurulum tamamlandı tenant=${installation.tenantId}`)

    // Kurulum sonrası kullanıcıyı ayar ekranına al.
    return Response.redirect(new URL(POST_INSTALL_PATH, url.origin), 302)
  } catch (error) {
    // invalid_grant → code tükenmiş; kullanıcı Connect'i baştan başlatmalı.
    if (error instanceof UnauthorizedError) {
      console.log(`${LOG_PREFIX} kurulum reddedildi`)
    }
    return toErrorResponse(error, LOG_PREFIX)
  }
}
