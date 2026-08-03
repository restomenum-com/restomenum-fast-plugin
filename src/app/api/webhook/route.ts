import { buildContainer, type Container } from '@/lib/container'
import { toErrorResponse } from '@/lib/errors'

/**
 * Webhook ucu.
 *
 * Akış: **ham gövde → imza → dayanıklı kuyruğa → hemen 2xx**.
 * Ağır iş yanıtı bekletmez; süre sınırı için `/docs/limits` (§4.2).
 * Tekilleştirme ve işleme kuyruk tüketicisinde yapılır.
 */

const SIGNATURE_HEADER = 'x-restomenum-signature'
const LOG_PREFIX = 'webhook:'

/** Test edilebilir çekirdek — bağımlılıklar parametreden gelir (§2.2). */
export async function handleWebhook(request: Request, container: Container): Promise<Response> {
  try {
    // 🔴 İmza HAM gövde üzerinden doğrulanır — request.json() burada ÇAĞRILMAZ.
    const rawBody = await request.text()
    const event = await container.webhooks.verify(rawBody, request.headers.get(SIGNATURE_HEADER))

    await container.eventQueue.enqueue(event)
    return new Response(null, { status: 202 })
  } catch (error) {
    // Geçersiz imza → 401. Platform retry'lar; kalıcı hatada teslim sağlığı düşer.
    return toErrorResponse(error, LOG_PREFIX)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, buildContainer())
}
