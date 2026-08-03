import { z } from 'zod'
import { gateResponse } from '@restomenum/plugin-sdk'

import { buildContainer, type Container } from '@/lib/container'
import { toErrorResponse } from '@/lib/errors'

/**
 * Flow-blocking hook (gate) ucu — platform bu yanıtı BEKLER, işlem durur.
 * 🔴 Gecikme doğrudan personelin ekranını dondurur; ağır iş yapılmaz.
 * Süre sınırı ve `failMode` için `/docs/limits`.
 */

const LOG_PREFIX = 'hook:'

const gateSchema = z.object({
  type: z.literal('hook'),
  event: z.string().min(1),
  tenantId: z.string().min(1),
  environment: z.enum(['sandbox', 'production']).optional(),
})

export async function handleHook(request: Request, container: Container): Promise<Response> {
  try {
    const { body } = await container.signedRequests.verify(request, gateSchema)
    console.log(`${LOG_PREFIX} event=${body.event} env=${body.environment ?? 'bilinmiyor'}`)

    // Varsayılan: akışı engelleme. Eklentiye özgü kural burada 'deny' dönebilir.
    return Response.json(gateResponse('allow'))
  } catch (error) {
    return toErrorResponse(error, LOG_PREFIX)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleHook(request, buildContainer())
}
