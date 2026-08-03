import { z } from 'zod'
import { actionResponse } from '@restomenum/plugin-sdk'

import { buildContainer, type Container } from '@/lib/container'
import { toErrorResponse } from '@/lib/errors'

/**
 * Panel buton (action) ucu — SENKRON yanıt verir.
 * Uzun süren iş burada YAPILMAZ; süre sınırı için `/docs/limits`.
 */

const LOG_PREFIX = 'action:'

/** Kullanılan alanlar doğrulanır; tanınmayan alanlar yok sayılır (ileriye dönük uyumluluk). */
const actionSchema = z.object({
  id: z.string().min(1),
  hook: z.string().min(1),
  tenantId: z.string().min(1),
  environment: z.enum(['sandbox', 'production']).optional(),
  actor: z
    .object({ userId: z.string().optional(), role: z.string().optional() })
    .optional(),
})

export async function handleAction(request: Request, container: Container): Promise<Response> {
  try {
    const { body } = await container.signedRequests.verify(request, actionSchema)
    console.log(`${LOG_PREFIX} hook=${body.hook} env=${body.environment ?? 'bilinmiyor'}`)

    // Eklentiye özgü aksiyonlar buradan dallanır.
    return Response.json(
      actionResponse(true, 'İşlem alındı.', { level: 'success', display: 'toast' }),
    )
  } catch (error) {
    return toErrorResponse(error, LOG_PREFIX)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleAction(request, buildContainer())
}
