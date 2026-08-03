import { signPayload } from '@restomenum/plugin-sdk'

import { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import { InstallationService } from '@/services/InstallationService'
import { SessionService } from '@/services/SessionService'
import { SignedRequestService } from '@/services/SignedRequestService'
import { WebhookService } from '@/services/WebhookService'
import { Installation } from '@/models/Installation'
import { encryptSecret } from '@/lib/crypto'
import type { Container } from '@/lib/container'
import {
  MemoryEventLogRepository,
  MemoryInstallationRepository,
} from '@/testing/memoryRepositories'

/** Testler için ortak kurulum — YALNIZ test kodundan kullanılır. */

/** Portalda oluşturulan gerçek eklentinin kimliği (gizli değil). */
export const PLUGIN_ID = '27750a08-8a8e-43b5-a27e-e213305cbe25'
export const OTHER_PLUGIN_ID = '00000000-0000-4000-8000-000000000000'

export const TENANT_A = 'tenant-a'
export const TENANT_B = 'tenant-b'

/** Test fixture'ları — gerçek secret DEĞİL. */
export const SECRET_A = 'webhook-secret-of-tenant-a'
export const SECRET_B = 'webhook-secret-of-tenant-b'
export const ENCRYPTION_KEY = 'zJ8kQm2Xv5PbN7rT1yUw9cE4hL6aS0dG3fH8jK5nM2Q='

export const SIGNATURE_HEADER = 'x-restomenum-signature'
export const REPLAY_WINDOW_SEC = 300
export const MS_PER_SEC = 1000

/** İki tenant kurulu, tam bağlı bir container üretir. */
export async function buildTestContainer(): Promise<Container> {
  const repository = new MemoryInstallationRepository()

  const installations = new InstallationService({
    adapter: new RestomenumAdapter({
      environment: 'sandbox',
      pluginId: PLUGIN_ID,
      clientSecret: 'bu-testlerde-kullanilmiyor',
    }),
    repository,
    encryptionKey: ENCRYPTION_KEY,
  })

  for (const [tenantId, secret] of [
    [TENANT_A, SECRET_A],
    [TENANT_B, SECRET_B],
  ] as const) {
    await repository.upsert(
      new Installation({
        tenantId,
        apiKey: await encryptSecret('api-key', ENCRYPTION_KEY),
        webhookSecret: await encryptSecret(secret, ENCRYPTION_KEY),
        scopes: ['orders:read'],
        installedAt: 1,
        updatedAt: 1,
      }),
    )
  }

  return {
    config: {
      pluginId: PLUGIN_ID,
      clientSecret: 'bu-testlerde-kullanilmiyor',
      environment: 'sandbox',
      encryptionKey: ENCRYPTION_KEY,
    },
    installations,
    sessions: new SessionService({ installations, pluginId: PLUGIN_ID }),
    signedRequests: new SignedRequestService({ installations }),
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
  role?: string
  expOffsetSec?: number
  algorithm?: string
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / MS_PER_SEC)
  const audience = params.aud ?? PLUGIN_ID
  const signingInput = `${base64Url({ alg: params.algorithm ?? 'HS256', typ: 'JWT' })}.${base64Url({
    iss: 'restomenum',
    aud: audience,
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
