import { signPayload } from '@restomenum/plugin-sdk'

import { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import { InstallationService } from '@/services/InstallationService'
import { SessionService } from '@/services/SessionService'
import { SignedRequestService } from '@/services/SignedRequestService'
import { WebhookService } from '@/services/WebhookService'
import { MaintenanceService } from '@/services/MaintenanceService'
import { Installation } from '@/models/Installation'
import { encryptSecret } from '@/lib/crypto'
import type { Container } from '@/lib/container'
import type { EventQueue } from '@/services/EventQueue'
import type { VerifiedEvent } from '@/services/WebhookService'
import {
  MemoryEventLogRepository,
  MemoryInstallationRepository,
} from '@/testing/memoryRepositories'

/** Testler için ortak kurulum — YALNIZ test kodundan kullanılır. */

/**
 * Test kimlikleri — UYDURMADIR, gerçek portal kaydıyla ilgisi yoktur.
 *
 * 🔴 Gerçek `pluginId` ve `client_secret` KODA YAZILMAZ; `.dev.vars`'ta durur ve
 * `config.ts` üzerinden okunur. Testlerin tek ihtiyacı iki FARKLI kimlik olması:
 * biri bizim eklentimiz, diğeri `aud` reddini sınamak için başkasının.
 */
export const PLUGIN_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_PLUGIN_ID = '22222222-2222-4222-8222-222222222222'

export const TENANT_A = 'tenant-a'
export const TENANT_B = 'tenant-b'

/** Test fixture'ları — gerçek secret DEĞİL. */
export const SECRET_A = 'webhook-secret-of-tenant-a'
export const SECRET_B = 'webhook-secret-of-tenant-b'
/** AYNI tenantId'nin PRODUCTION ortamındaki FARKLI secret'ı. */
export const SECRET_A_PROD = 'webhook-secret-of-tenant-a-PRODUCTION'
export const ENCRYPTION_KEY = 'zJ8kQm2Xv5PbN7rT1yUw9cE4hL6aS0dG3fH8jK5nM2Q='

export const SIGNATURE_HEADER = 'x-restomenum-signature'
export const REPLAY_WINDOW_SEC = 300
export const MS_PER_SEC = 1000

/**
 * Test kuyruğu: enqueue edilen olayları toplar ve istenirse işler.
 * Gerçek kuyruk gibi davranır — kabul eder, sonra tüketici çalıştırılır.
 */
export class RecordingEventQueue implements EventQueue {
  readonly events: VerifiedEvent[] = []

  async enqueue(event: VerifiedEvent): Promise<void> {
    this.events.push(event)
  }
}

/** İki tenant kurulu, tam bağlı bir container üretir. */
export async function buildTestContainer(): Promise<Container> {
  const repository = new MemoryInstallationRepository()

  const installations = new InstallationService({
    adapter: new RestomenumAdapter({
      pluginId: PLUGIN_ID,
      clientSecret: 'bu-testlerde-kullanilmiyor',
    }),
    repository,
    encryptionKey: ENCRYPTION_KEY,
  })

  // Üç kurulum: iki sandbox tenant'ı + AYNI tenantId'nin production karşılığı.
  // Sonuncusu cross-environment ezilmesini ve secret karışmasını sınamak içindir.
  for (const [environment, tenantId, secret] of [
    ['sandbox', TENANT_A, SECRET_A],
    ['sandbox', TENANT_B, SECRET_B],
    ['production', TENANT_A, SECRET_A_PROD],
  ] as const) {
    await repository.upsert(
      new Installation({
        environment,
        tenantId,
        apiKey: await encryptSecret(`api-key-${environment}`, ENCRYPTION_KEY),
        webhookSecret: await encryptSecret(secret, ENCRYPTION_KEY),
        scopes: ['orders:read'],
        installedAt: 1,
        updatedAt: 1,
      }),
    )
  }

  const eventQueue = new RecordingEventQueue()

  return {
    eventQueue,
    config: {
      pluginId: PLUGIN_ID,
      clientSecret: 'bu-testlerde-kullanilmiyor',
      encryptionKey: ENCRYPTION_KEY,
    },
    installations,
    sessions: new SessionService({
      installations,
      pluginId: PLUGIN_ID,
    }),
    signedRequests: new SignedRequestService({ installations }),
    maintenance: new MaintenanceService({ eventLog: new MemoryEventLogRepository() }),
    webhooks: new WebhookService({
      installations,
      eventLog: new MemoryEventLogRepository(),
    }),
  }
}

/** SDK'nın kendi imzalayıcısıyla gerçek imzalı istek üretir. */
export function signedRequest(
  url: string,
  body: unknown,
  secret: string,
  timestampSec?: number,
): Request {
  const raw = JSON.stringify(body)
  const signature =
    timestampSec === undefined ? signPayload(raw, secret) : signPayload(raw, secret, timestampSec)
  return new Request(url, {
    method: 'POST',
    headers: { [SIGNATURE_HEADER]: signature, 'content-type': 'application/json' },
    body: raw,
  })
}

export function webhookBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    type: 'table.created',
    version: '1',
    environment: 'sandbox',
    tenantId: TENANT_A,
    occurredAt: Date.now(),
    data: {},
    ...overrides,
  }
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Session token üretir — saldırı senaryoları için her alan zorlanabilir. */
export async function makeSessionToken(params: {
  secret: string
  aud?: string
  tenantId?: string
  /** Platform artık bu claim'i gönderiyor (canlıda ölçüldü). */
  environment?: string
  role?: string
  expOffsetSec?: number
  algorithm?: string
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / MS_PER_SEC)
  const audience = params.aud ?? PLUGIN_ID
  const signingInput = `${base64Url({ alg: params.algorithm ?? 'HS256', typ: 'JWT' })}.${base64Url({
    iss: 'restomenum',
    aud: audience,
    environment: params.environment ?? 'sandbox',
    sub: 'user-1',
    role: params.role ?? 'manager',
    tenantId: params.tenantId ?? TENANT_A,
    pluginId: audience,
    iat: nowSec,
    exp: nowSec + (params.expOffsetSec ?? 120),
  })}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(params.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${Buffer.from(new Uint8Array(signature)).toString('base64url')}`
}

export function sessionRequest(token: string | null): Request {
  return new Request('https://x/api/session/me', {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })
}
