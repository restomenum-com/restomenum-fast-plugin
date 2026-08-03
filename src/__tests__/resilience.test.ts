import { describe, expect, it, vi } from 'vitest'

import { computeDelayMs, withRetry } from '@/lib/retry'
import { UnauthorizedError, UpstreamError } from '@/lib/errors'
import { MaintenanceService, SEEN_EVENT_RETENTION_DAYS } from '@/services/MaintenanceService'
import { MemoryEventLogRepository } from '@/testing/memoryRepositories'
import { runQueueBatch, type QueueBatch, type QueueMessage } from '@/worker/handlers'
import type { VerifiedEvent } from '@/services/WebhookService'
import type { TenantRef } from '@/models/TenantRef'

/** Dayanıklılık katmanı: yeniden deneme · budama · kuyruk tüketicisi. */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const REF: TenantRef = { environment: 'sandbox', tenantId: 'tenant-a' }

/** Beklemeyi anında geçen sahte uyku — testler gerçek zaman harcamaz. */
function instantSleep() {
  const waited: number[] = []
  return {
    waited,
    sleep: async (ms: number) => {
      waited.push(ms)
    },
  }
}

describe('withRetry — geçici hatalar', () => {
  it('geçici hatadan sonra başarıya ulaşır', async () => {
    const { sleep } = instantSleep()
    let attempts = 0
    const operation = async () => {
      attempts++
      if (attempts < 3) throw new UpstreamError('429', { retryable: true })
      return 'tamam'
    }

    const result = await withRetry(operation, {
      sleep,
      random: () => 0.5,
      isRetryable: (e) => e instanceof UpstreamError && e.retryable,
    })

    expect(result).toBe('tamam')
    expect(attempts).toBe(3)
  })

  it('🔴 yeniden denenemez hatayı ANINDA fırlatır (boşuna bekleme yok)', async () => {
    const { sleep, waited } = instantSleep()
    const operation = vi.fn(async () => {
      throw new UnauthorizedError('yetkisiz')
    })

    await expect(
      withRetry(operation, {
        sleep,
        isRetryable: (e) => e instanceof UpstreamError && e.retryable,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    expect(operation).toHaveBeenCalledOnce()
    expect(waited).toHaveLength(0)
  })

  it('deneme hakkı bitince son hatayı fırlatır', async () => {
    const { sleep } = instantSleep()
    const operation = vi.fn(async () => {
      throw new UpstreamError('sürekli 503', { retryable: true })
    })

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        sleep,
        random: () => 0.5,
        isRetryable: (e) => e instanceof UpstreamError && e.retryable,
      }),
    ).rejects.toBeInstanceOf(UpstreamError)

    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('`Retry-After` geldiğinde jitter yerine ONA uyar', async () => {
    const { sleep, waited } = instantSleep()
    let attempts = 0
    const operation = async () => {
      attempts++
      if (attempts === 1) throw new UpstreamError('429', { retryable: true, retryAfterSeconds: 2 })
      return 'tamam'
    }

    await withRetry(operation, {
      sleep,
      random: () => 0.5,
      isRetryable: (e) => e instanceof UpstreamError && e.retryable,
      retryAfterSeconds: (e) => (e instanceof UpstreamError ? e.retryAfterSeconds : undefined),
    })

    expect(waited).toEqual([2000])
  })
})

describe('computeDelayMs — full jitter', () => {
  it('üstel olarak artar ve tavana takılır', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 }
    expect(computeDelayMs(0, options)).toBe(100)
    expect(computeDelayMs(1, options)).toBe(200)
    expect(computeDelayMs(2, options)).toBe(400)
    expect(computeDelayMs(5, options)).toBe(1000) // tavan
  })

  it('🔴 jitter uygular — aynı anda 429 yiyenler AYNI anda dönmez', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 1000 }
    const a = computeDelayMs(2, { ...options, random: () => 0.1 })
    const b = computeDelayMs(2, { ...options, random: () => 0.9 })
    expect(a).not.toBe(b)
    expect(a).toBeLessThan(b)
  })
})

describe('MaintenanceService — dedup budama', () => {
  it('süresi dolmuş kayıtları siler, tazeleri BIRAKIR', async () => {
    let clock = 0
    const eventLog = new MemoryEventLogRepository(() => clock)

    clock = 0
    await eventLog.markSeen(REF, 'eski-1')
    await eventLog.markSeen(REF, 'eski-2')

    clock = SEEN_EVENT_RETENTION_DAYS * MS_PER_DAY + 1000
    await eventLog.markSeen(REF, 'yeni-1')

    const maintenance = new MaintenanceService({ eventLog, now: () => clock })
    const removed = await maintenance.pruneSeenEvents()

    expect(removed).toBe(2)
    // Taze kayıt duruyor → tekrar gelen olay hâlâ yinelenen sayılır.
    expect(await eventLog.markSeen(REF, 'yeni-1')).toBe(false)
    // Budanan kayıt gitti.
    expect(await eventLog.markSeen(REF, 'eski-1')).toBe(true)
  })

  it('saklama süresi platformun retry penceresinden uzun', () => {
    // Platform en fazla ~1 saat retry'lar; budama penceresi belirgin ölçüde uzun olmalı.
    const oneHourDays = 1 / 24
    expect(SEEN_EVENT_RETENTION_DAYS).toBeGreaterThan(oneHourDays * 24)
  })
})

describe('runQueueBatch — tüketici', () => {
  function message(event: Partial<VerifiedEvent>): QueueMessage & { acked: number; retried: number } {
    const m = {
      body: event,
      acked: 0,
      retried: 0,
      ack() {
        m.acked++
      },
      retry() {
        m.retried++
      },
    }
    return m
  }

  const event = (id: string): Partial<VerifiedEvent> => ({
    envelope: { id, type: 'table.created', version: '1', tenantId: 'tenant-a', occurredAt: 0, data: {} },
    ref: REF,
  })

  it('başarılı mesajı ACK eder', async () => {
    const m = message(event('e1'))
    await runQueueBatch({ messages: [m] } as QueueBatch, async () => {})
    expect(m.acked).toBe(1)
    expect(m.retried).toBe(0)
  })

  it('🔴 hatalı mesajı RETRY eder (olay kaybolmaz)', async () => {
    const m = message(event('e1'))
    await runQueueBatch({ messages: [m] } as QueueBatch, async () => {
      throw new Error('geçici')
    })
    expect(m.retried).toBe(1)
    expect(m.acked).toBe(0)
  })

  it('🔴 bir mesajın hatası DİĞERLERİNİ etkilemez (parti geri alınmaz)', async () => {
    const ok1 = message(event('ok-1'))
    const bad = message(event('bad'))
    const ok2 = message(event('ok-2'))

    await runQueueBatch({ messages: [ok1, bad, ok2] } as QueueBatch, async (e) => {
      if (e.envelope.id === 'bad') throw new Error('geçici')
    })

    expect(ok1.acked).toBe(1)
    expect(ok2.acked).toBe(1)
    expect(bad.retried).toBe(1)
    // Başarılılar yeniden işlenmez → dedup'a gereksiz yük binmez.
    expect(ok1.retried).toBe(0)
    expect(ok2.retried).toBe(0)
  })
})
