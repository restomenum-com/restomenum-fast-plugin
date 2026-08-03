import { beforeEach, describe, expect, it } from 'vitest'

import { handleWebhook } from '@/app/api/webhook/route'
import { handleAction } from '@/app/api/action/route'
import { handleSessionMe } from '@/app/api/session/me/route'
import type { Container } from '@/lib/container'
import {
  SECRET_A,
  SECRET_A_PROD,
  TENANT_A,
  RecordingEventQueue,
  buildTestContainer,
  makeSessionToken,
  sessionRequest,
  signedRequest,
  webhookBody,
} from '@/testing/harness'

/**
 * ORTAM İZOLASYONU.
 *
 * Yayınlanmış tek sürüm hem sandbox (dev store) hem production trafiği alır ve iki
 * ortamın kimlik bilgileri FARKLIDIR. Bu testler `tenantId`'nin tek başına kimlik
 * olmadığını doğrular: aynı tenantId iki ortamda ayrı secret'larla kuruludur.
 */

let container: Container

beforeEach(async () => {
  container = await buildTestContainer()
})

describe('webhook — ortam ayrımı', () => {
  it('sandbox olayı sandbox secret ile doğrulanır', async () => {
    const body = webhookBody({ environment: 'sandbox', tenantId: TENANT_A })
    const request = signedRequest('https://x/api/webhook', body, SECRET_A)
    expect((await handleWebhook(request, container)).status).toBe(202)
  })

  it('production olayı production secret ile doğrulanır', async () => {
    const body = webhookBody({ environment: 'production', tenantId: TENANT_A })
    const request = signedRequest('https://x/api/webhook', body, SECRET_A_PROD)
    expect((await handleWebhook(request, container)).status).toBe(202)
  })

  it('🔴 SANDBOX secret ile imzalanmış PRODUCTION olayı REDDEDİLİR', async () => {
    // Ortam ayrımı olmasaydı sandbox secret'ı production trafiğini doğrulardı.
    const body = webhookBody({ environment: 'production', tenantId: TENANT_A })
    const request = signedRequest('https://x/api/webhook', body, SECRET_A)
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 PRODUCTION secret ile imzalanmış SANDBOX olayı REDDEDİLİR', async () => {
    const body = webhookBody({ environment: 'sandbox', tenantId: TENANT_A })
    const request = signedRequest('https://x/api/webhook', body, SECRET_A_PROD)
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 ortamı değiştirmek imzayı geçersiz kılar (gövde imzalı)', async () => {
    // Saldırgan `environment`'ı değiştirirse imza tutmaz — alan imzalı gövdededir.
    const signedAsSandbox = webhookBody({ environment: 'sandbox', tenantId: TENANT_A })
    const raw = JSON.stringify(signedAsSandbox)
    const tampered = JSON.stringify({ ...signedAsSandbox, environment: 'production' })

    const { signPayload } = await import('@restomenum/plugin-sdk')
    const request = new Request('https://x/api/webhook', {
      method: 'POST',
      headers: { 'x-restomenum-signature': signPayload(raw, SECRET_A) },
      body: tampered,
    })
    expect((await handleWebhook(request, container)).status).toBe(401)
  })
})

describe('dedup — ortam ayrımı', () => {
  it('aynı eventId iki ORTAMDA ayrı ayrı işlenir', async () => {
    const sandbox = webhookBody({ id: 'shared-evt', environment: 'sandbox', tenantId: TENANT_A })
    const production = webhookBody({
      id: 'shared-evt',
      environment: 'production',
      tenantId: TENANT_A,
    })

    await handleWebhook(signedRequest('https://x/api/webhook', sandbox, SECRET_A), container)
    await handleWebhook(
      signedRequest('https://x/api/webhook', production, SECRET_A_PROD),
      container,
    )

    // Tüketici her ikisini de işler: farklı ortam → dedup birbirini bastırmaz.
    const queue = container.eventQueue as RecordingEventQueue
    for (const event of queue.events) {
      expect(await container.webhooks.process(event)).toBeUndefined()
    }
    expect(queue.events).toHaveLength(2)
  })
})

describe('action — ortam ayrımı', () => {
  const body = (environment: string) => ({
    id: 'act-1',
    hook: 'send',
    tenantId: TENANT_A,
    environment,
  })

  it('production action production secret ile geçer', async () => {
    const request = signedRequest('https://x/api/action', body('production'), SECRET_A_PROD)
    expect((await handleAction(request, container)).status).toBe(200)
  })

  it('🔴 sandbox secret ile imzalanmış production action REDDEDİLİR', async () => {
    const request = signedRequest('https://x/api/action', body('production'), SECRET_A)
    expect((await handleAction(request, container)).status).toBe(401)
  })
})

describe('session token — ortam claim\'i', () => {
  it('sandbox oturumu SANDBOX kurulumunu döner', async () => {
    const token = await makeSessionToken({
      secret: SECRET_A,
      tenantId: TENANT_A,
      environment: 'sandbox',
    })
    const response = await handleSessionMe(sessionRequest(token), container)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      installation: { tenantId: TENANT_A, environment: 'sandbox' },
    })
  })

  it('production oturumu PRODUCTION kurulumunu döner', async () => {
    const token = await makeSessionToken({
      secret: SECRET_A_PROD,
      tenantId: TENANT_A,
      environment: 'production',
    })
    const response = await handleSessionMe(sessionRequest(token), container)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      installation: { tenantId: TENANT_A, environment: 'production' },
    })
  })

  it('🔴 PRODUCTION iddia edip SANDBOX secret ile imzalanan token REDDEDİLİR', async () => {
    // Aynı tenantId iki ortamda kurulu; ortam yükseltme denemesi imzada takılır.
    const token = await makeSessionToken({
      secret: SECRET_A,
      tenantId: TENANT_A,
      environment: 'production',
    })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it('🔴 SANDBOX iddia edip PRODUCTION secret ile imzalanan token REDDEDİLİR', async () => {
    const token = await makeSessionToken({
      secret: SECRET_A_PROD,
      tenantId: TENANT_A,
      environment: 'sandbox',
    })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })
})

describe('ortam eksikse — fail-closed', () => {
  it('🔴 `environment` alanı OLMAYAN webhook reddedilir (varsayılana düşmez)', async () => {
    // Statik bir varsayılan olsaydı bu istek sessizce o ortama yazılır ve
    // sonraki tüm teslimler yanlış anahtarda arandığı için 401 olurdu.
    const body = webhookBody({ tenantId: TENANT_A })
    delete (body as Record<string, unknown>)['environment']

    const request = signedRequest('https://x/api/webhook', body, SECRET_A)
    expect((await handleWebhook(request, container)).status).toBe(400)
  })

  it('🔴 `environment` alanı OLMAYAN action reddedilir', async () => {
    const body = { id: 'act-1', hook: 'send', tenantId: TENANT_A }
    const request = signedRequest('https://x/api/action', body, SECRET_A)
    expect((await handleAction(request, container)).status).toBe(400)
  })

  it('🔴 `environment` claim\'i OLMAYAN session token reddedilir', async () => {
    const withoutEnv = await makeSessionToken({
      secret: SECRET_A,
      tenantId: TENANT_A,
      environment: '',
    })
    expect((await handleSessionMe(sessionRequest(withoutEnv), container)).status).toBe(401)
  })
})
