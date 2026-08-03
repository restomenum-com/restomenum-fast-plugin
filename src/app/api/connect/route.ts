import type { Environment } from '@restomenum/plugin-sdk'

import { buildContainer } from '@/lib/container'
import { CONNECT_STATE_TTL_SECONDS } from '@/config'
import { createSignedState, isOwnState, verifySignedState } from '@/lib/crypto'
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

/**
 * Kurulum bittiğinde gidilecek yol.
 * 🔴 `/settings` OLAMAZ: OAuth akışı ÜST PENCEREDE döner, orası ise yalnız panel
 * iframe'i içinde çalışan bir sayfadır ve App Bridge bulamayıp hata gösterir.
 */
const POST_INSTALL_PATH = '/installed'

/** Ortamı taşıyabilecek parametre adları — platform hangisini kullanırsa yakalanır. */
const ENVIRONMENT_PARAMS = ['environment', 'env', 'mode'] as const

/**
 * Connect çağrısındaki ortamı çözer.
 *
 * 🔴 Varsayılan YOKTUR. Ortam bilinmeden kurulum yazılamaz: yanlış ortam anahtarına
 * yazılan credential sessizce ölü kalır — kurulum başarılı görünür ama sonraki her
 * webhook `(doğru ortam, tenant)` arayıp bulamaz ve 401 döner. Fail-closed.
 */
function resolveEnvironment(url: URL): Environment | undefined {
  for (const name of ENVIRONMENT_PARAMS) {
    const value = url.searchParams.get(name)
    if (value === 'sandbox' || value === 'production') return value
  }
  return undefined
}

export async function GET(request: Request): Promise<Response> {
  try {
    const container = buildContainer()
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const nowSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND)

    // Hangi parametrelerin geldiğini görünür kıl — DEĞERLER değil yalnız ADLAR yazılır
    // (`code` ve `state` hassastır).
    console.log(`${LOG_PREFIX} connect parametreleri: ${[...url.searchParams.keys()].join(', ')}`)

    // Akışın başı: imzalı state üret. Sunucuda nonce saklamaya gerek yok.
    if (code === null) {
      const issued = await createSignedState(nowSeconds, container.config.clientSecret)
      return Response.json({ state: issued })
    }

    if (state === null || state.length === 0) {
      throw new ValidationError('state parametresi eksik.')
    }

    if (isOwnState(state)) {
      // Akışı BİZ başlattık → kendi imzamızı katı biçimde doğrularız (fail-closed).
      await verifySignedState(
        state,
        container.config.clientSecret,
        nowSeconds,
        CONNECT_STATE_TTL_SECONDS,
      )
    } else {
      // Kurulumu marketplace başlattı: `state` PLATFORM tarafından üretildi ve bize opaktır —
      // imzalamadığımız bir değeri doğrulayamayız, reddetmek her kurulumu kırardı.
      //
      // Bu akışta gerçek bariyer `code`'dur: tek kullanımlık ve yalnız sunucuda tutulan
      // `client_secret` ile takas edilebilir. Uydurma bir code ile gelen saldırgan token
      // değişiminde `invalid_grant` alır (canlı uçta doğrulandı).
      console.log(`${LOG_PREFIX} platform kaynaklı state — doğrulama code takasında yapılır`)
    }

    const environment = resolveEnvironment(url)
    if (environment === undefined) {
      throw new ValidationError(
        'Connect çağrısında ortam bilgisi yok (environment). Kurulum yazılamaz.',
      )
    }
    console.log(`${LOG_PREFIX} ortam=${environment}`)

    const installation = await container.installations.completeInstall(code, environment)
    console.log(
      `${LOG_PREFIX} kurulum tamamlandı env=${installation.environment} tenant=${installation.tenantId}`,
    )

    // Kullanıcı üst pencerede; iframe'e özgü olmayan bir onay sayfasına alınır.
    return Response.redirect(new URL(POST_INSTALL_PATH, url.origin), 302)
  } catch (error) {
    // invalid_grant → code tükenmiş; kullanıcı Connect'i baştan başlatmalı.
    if (error instanceof UnauthorizedError) {
      console.log(`${LOG_PREFIX} kurulum reddedildi`)
    }
    return toErrorResponse(error, LOG_PREFIX)
  }
}
