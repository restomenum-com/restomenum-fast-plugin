import { beforeEach, describe, expect, it } from 'vitest'

import { handleSessionMe } from '@/app/api/session/me/route'
import type { Container } from '@/lib/container'
import {
  OTHER_PLUGIN_ID,
  SECRET_A,
  SECRET_B,
  TENANT_A,
  TENANT_B,
  buildTestContainer,
  makeSessionToken,
  sessionRequest,
} from '@/testing/harness'

/**
 * iframe session token yüzeyinin güvenlik testleri.
 *
 * Pozitif senaryolar TENANT_B kullanır: TENANT_A bilerek İKİ ortamda da kuruludur ve
 * ortam bilgisi token'da bulunmadığı için oturumu belirsiz kalır (fail-closed reddedilir).
 * O davranış `environment.isolation.test.ts` içinde ayrıca sınanır.
 */

let container: Container

beforeEach(async () => {
  container = await buildTestContainer()
})

describe('session token — kabul', () => {
  it('geçerli token kabul edilir ve claim kaynaklı veri döner', async () => {
    const response = await handleSessionMe(
      sessionRequest(await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_B, environment: 'sandbox' })),
      container,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { id: 'user-1', role: 'manager' },
      installation: { tenantId: TENANT_B, environment: 'sandbox' },
    })
  })
})

describe('session token — reddetme', () => {
  it("🔴 BAŞKA EKLENTİNİN token'ı reddedilir (aud kontrolü)", async () => {
    const token = await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_B, aud: OTHER_PLUGIN_ID })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it('🔴 süresi geçmiş token reddedilir', async () => {
    const token = await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_B, expOffsetSec: -60 })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it('🔴 yanlış secret ile imzalanan token reddedilir', async () => {
    const token = await makeSessionToken({ secret: 'uydurma-anahtar', tenantId: TENANT_B })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it("🔴 CROSS-TENANT: A secret'ıyla imzalanıp tenantId=B iddia eden token reddedilir", async () => {
    const token = await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_A })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it('🔴 alg:none saldırısı reddedilir', async () => {
    const token = await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_B, algorithm: 'none' })
    expect((await handleSessionMe(sessionRequest(token), container)).status).toBe(401)
  })

  it('🔴 token yoksa 401', async () => {
    expect((await handleSessionMe(sessionRequest(null), container)).status).toBe(401)
  })
})

describe('sızıntı', () => {
  it('session/me yanıtı apiKey / webhookSecret İÇERMEZ', async () => {
    const response = await handleSessionMe(
      sessionRequest(await makeSessionToken({ secret: SECRET_B, tenantId: TENANT_B, environment: 'sandbox' })),
      container,
    )
    const text = await response.text()

    expect(text).not.toContain('webhookSecret')
    expect(text).not.toContain('apiKey')
    expect(text).not.toContain(SECRET_B)
  })
})
