import { beforeEach, describe, expect, it } from 'vitest'
import { signPayload } from '@restomenum/plugin-sdk'

import { handleWebhook } from '@/app/api/webhook/route'
import { handleAction } from '@/app/api/action/route'
import { handleHook } from '@/app/api/hook/route'
import type { Container } from '@/lib/container'
import {
  MS_PER_SEC,
  REPLAY_WINDOW_SEC,
  SECRET_A,
  SECRET_B,
  SIGNATURE_HEADER,
  TENANT_A,
  RecordingEventQueue,
  buildTestContainer,
  signedRequest,
  webhookBody,
} from '@/testing/harness'

/**
 * İmza yüzeyinin güvenlik testleri — gerçek uç fonksiyonlarına gerçek `Request` ile vurur.
 * Kapsam: saldırgan/negatif yollar. "Platform gerçekten böyle gönderiyor" doğrulaması
 * bu testin kapsamı DIŞINDADIR — o gerçek kurulum ister (§2.7).
 */

let container: Container

beforeEach(async () => {
  container = await buildTestContainer()
})

describe('webhook — imza doğrulaması', () => {
  it('geçerli imzayı kabul eder → 202', async () => {
    const request = signedRequest('https://x/api/webhook', webhookBody(), SECRET_A)
    expect((await handleWebhook(request, container)).status).toBe(202)
  })

  it('🔴 imza header yoksa 401', async () => {
    const request = new Request('https://x/api/webhook', {
      method: 'POST',
      body: JSON.stringify(webhookBody()),
    })
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 gövde imzalandıktan SONRA değiştirilmişse 401', async () => {
    const original = webhookBody()
    const signature = signPayload(JSON.stringify(original), SECRET_A)
    const tampered = JSON.stringify({ ...original, data: { injected: true } })

    const request = new Request('https://x/api/webhook', {
      method: 'POST',
      headers: { [SIGNATURE_HEADER]: signature },
      body: tampered,
    })
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 replay penceresi dışındaki eski imzayı reddeder', async () => {
    const stale = Math.floor(Date.now() / MS_PER_SEC) - (REPLAY_WINDOW_SEC + 60)
    const request = signedRequest('https://x/api/webhook', webhookBody(), SECRET_A, stale)
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it("🔴 CROSS-TENANT: B'nin secret'ıyla A adına imzalanan istek reddedilir", async () => {
    const request = signedRequest(
      'https://x/api/webhook',
      webhookBody({ tenantId: TENANT_A }),
      SECRET_B,
    )
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 kurulu olmayan tenant reddedilir', async () => {
    const request = signedRequest(
      'https://x/api/webhook',
      webhookBody({ tenantId: 'kurulu-degil' }),
      SECRET_A,
    )
    expect((await handleWebhook(request, container)).status).toBe(401)
  })

  it('🔴 imza geçersizken olay KUYRUĞA HİÇ girmez', async () => {
    const queue = container.eventQueue as RecordingEventQueue
    const request = signedRequest('https://x/api/webhook', webhookBody(), SECRET_B)

    await handleWebhook(request, container)

    expect(queue.events).toHaveLength(0)
  })

  it('geçerli imzada olay kuyruğa girer', async () => {
    const queue = container.eventQueue as RecordingEventQueue
    const request = signedRequest('https://x/api/webhook', webhookBody(), SECRET_A)

    await handleWebhook(request, container)

    expect(queue.events).toHaveLength(1)
    expect(queue.events[0]?.ref).toEqual({ environment: 'sandbox', tenantId: TENANT_A })
  })

  it('401 yanıtı secret sızdırmaz', async () => {
    const request = signedRequest('https://x/api/webhook', webhookBody(), SECRET_B)
    const text = await (await handleWebhook(request, container)).text()
    expect(text).not.toContain(SECRET_A)
    expect(text).not.toContain(SECRET_B)
  })
})

describe('action / hook — imza ve şema', () => {
  const actionBody = { id: 'act-1', hook: 'send', tenantId: TENANT_A, environment: 'sandbox' }
  const gateBody = { type: 'hook', event: 'table.close', tenantId: TENANT_A, environment: 'sandbox' }

  it('geçerli action imzası kabul edilir', async () => {
    const request = signedRequest('https://x/api/action', actionBody, SECRET_A)
    expect((await handleAction(request, container)).status).toBe(200)
  })

  it('🔴 yanlış secret ile imzalanan action 401', async () => {
    const request = signedRequest('https://x/api/action', actionBody, SECRET_B)
    expect((await handleAction(request, container)).status).toBe(401)
  })

  it('🔴 imza geçerli ama şema bozuksa 400', async () => {
    const request = signedRequest('https://x/api/action', { tenantId: TENANT_A }, SECRET_A)
    expect((await handleAction(request, container)).status).toBe(400)
  })

  it('geçerli gate imzası allow döner', async () => {
    const response = await handleHook(
      signedRequest('https://x/api/hook', gateBody, SECRET_A),
      container,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'allow' })
  })

  it('🔴 yanlış secret ile imzalanan gate 401', async () => {
    const request = signedRequest('https://x/api/hook', gateBody, SECRET_B)
    expect((await handleHook(request, container)).status).toBe(401)
  })
})
