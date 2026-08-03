import { describe, expect, it, vi } from 'vitest'
import { signPayload, type WebhookEnvelope } from '@restomenum/plugin-sdk'

import { WebhookService, type EventHandler } from '@/services/WebhookService'
import type { InstallationService } from '@/services/InstallationService'
import type { EventLogRepository } from '@/repositories/EventLogRepository'
import type { TenantRef } from '@/models/TenantRef'
import { UnauthorizedError } from '@/lib/errors'

const TENANT_ID = 'tenant-1'
const WEBHOOK_SECRET = 'test-secret-value'
const SIGNATURE_HEADER = 'x-restomenum-signature'
const REPLAY_WINDOW_SECONDS = 300
const MILLISECONDS_PER_SECOND = 1000
const REF: TenantRef = { environment: 'sandbox', tenantId: TENANT_ID }

function envelopeBody(overrides: Partial<WebhookEnvelope> = {}): string {
  return JSON.stringify({
    id: 'evt-1',
    type: 'table.created',
    version: '1',
    environment: 'sandbox',
    tenantId: TENANT_ID,
    occurredAt: Date.now(),
    data: {},
    ...overrides,
  })
}

/** Sahte bağımlılıklar enjekte edilir — gerçek servise bağlanılmaz (§2.2). */
function buildService(params: {
  secret?: string | undefined
  markSeen?: EventLogRepository['markSeen']
  handlers?: ReadonlyMap<string, EventHandler>
}) {
  const removeInstall = vi.fn(async () => {})
  const installations = {
    webhookSecretFor: async () => params.secret,
    removeInstall,
  } as unknown as InstallationService

  const release = vi.fn(async () => {})
  const eventLog: EventLogRepository = {
    markSeen: params.markSeen ?? (async () => true),
    release,
    pruneSeenBefore: async () => 0,
  }

  return {
    removeInstall,
    release,
    service: new WebhookService({
      installations,
      eventLog,
      ...(params.handlers !== undefined ? { handlers: params.handlers } : {}),
    }),
  }
}

describe('WebhookService.verify', () => {
  it('geçerli imzayı kabul eder', async () => {
    const body = envelopeBody()
    const { service } = buildService({ secret: WEBHOOK_SECRET })

    const { envelope, ref } = await service.verify(body, signPayload(body, WEBHOOK_SECRET))

    expect(envelope.tenantId).toBe(TENANT_ID)
    expect(envelope.id).toBe('evt-1')
    expect(ref).toEqual({ environment: 'sandbox', tenantId: TENANT_ID })
  })

  it('gövde oynanmışsa reddeder', async () => {
    const body = envelopeBody()
    const signature = signPayload(body, WEBHOOK_SECRET)
    const tampered = envelopeBody({ id: 'evt-2' })
    const { service } = buildService({ secret: WEBHOOK_SECRET })

    await expect(service.verify(tampered, signature)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('replay penceresi dışındaki imzayı reddeder', async () => {
    const body = envelopeBody()
    const staleSeconds =
      Math.floor(Date.now() / MILLISECONDS_PER_SECOND) - (REPLAY_WINDOW_SECONDS + 60)
    const { service } = buildService({ secret: WEBHOOK_SECRET })

    const stale = signPayload(body, WEBHOOK_SECRET, staleSeconds)

    await expect(service.verify(body, stale)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('imza header yoksa reddeder', async () => {
    const { service } = buildService({ secret: WEBHOOK_SECRET })

    await expect(service.verify(envelopeBody(), null)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('kurulu olmayan tenant için reddeder', async () => {
    const body = envelopeBody()
    const { service } = buildService({ secret: undefined })

    await expect(service.verify(body, signPayload(body, WEBHOOK_SECRET))).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })
})

describe('WebhookService.process', () => {
  const baseEnvelope: WebhookEnvelope = {
    id: 'evt-1',
    type: 'table.created',
    version: '1',
    environment: 'sandbox',
    tenantId: TENANT_ID,
    occurredAt: Date.now(),
    data: {},
  }

  it('yeni olayı işleyiciye verir', async () => {
    const handler = vi.fn(async () => {})
    const { service } = buildService({
      secret: WEBHOOK_SECRET,
      handlers: new Map([['table.created', handler]]),
    })

    await service.process({ envelope: baseEnvelope, ref: REF })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('yinelenen olayda işleyiciyi ÇAĞIRMAZ', async () => {
    const handler = vi.fn(async () => {})
    const { service } = buildService({
      secret: WEBHOOK_SECRET,
      markSeen: async () => false,
      handlers: new Map([['table.created', handler]]),
    })

    await service.process({ envelope: baseEnvelope, ref: REF })

    expect(handler).not.toHaveBeenCalled()
  })

  it('uninstall olayında kurulumu siler', async () => {
    const { service, removeInstall } = buildService({ secret: WEBHOOK_SECRET })

    await service.process({ envelope: { ...baseEnvelope, type: 'app.uninstalled' }, ref: REF })

    expect(removeInstall).toHaveBeenCalledWith(REF)
  })
})

describe('WebhookService dedup dayanıklılığı', () => {
  const baseEnvelope: WebhookEnvelope = {
    id: 'evt-9',
    type: 'table.created',
    version: '1',
    tenantId: TENANT_ID,
    occurredAt: Date.now(),
    data: {},
  }

  it('işleyici hata verirse sahiplenmeyi GERİ VERİR (olay kaybolmaz)', async () => {
    const failing: EventHandler = async () => {
      throw new Error('geçici hata')
    }
    const { service, release } = buildService({
      secret: WEBHOOK_SECRET,
      handlers: new Map([['table.created', failing]]),
    })

    await expect(
      service.process({ envelope: baseEnvelope, ref: REF }),
    ).rejects.toThrow('geçici hata')
    // release çağrılmazsa platform retry'ı dedup'a takılır ve iş hiç yapılmaz.
    expect(release).toHaveBeenCalledWith(REF, 'evt-9')
  })

  it('başarılı işlemede sahiplenmeyi geri VERMEZ', async () => {
    const { service, release } = buildService({
      secret: WEBHOOK_SECRET,
      handlers: new Map([['table.created', async () => {}]]),
    })

    await service.process({ envelope: baseEnvelope, ref: REF })

    expect(release).not.toHaveBeenCalled()
  })
})
