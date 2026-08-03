import { buildContainer, type Container } from '@/lib/container'
import { getExecutionContext } from '@/lib/bindings'
import { toErrorResponse } from '@/lib/errors'

/**
 * Webhook ucu.
 * Akış: **ham gövde → imza → dedup+işleme arka plana → hemen 2xx**.
 * Ağır iş yanıtı bekletmez; yanıt süresi sınırı için `/docs/limits` (§4.2).
 */

const SIGNATURE_HEADER = 'x-restomenum-signature'
const LOG_PREFIX = 'webhook:'

type WaitUntil = (promise: Promise<unknown>) => void

/** Test edilebilir çekirdek — bağımlılıklar parametreden gelir (§2.2). */
export async function handleWebhook(
  request: Request,
  container: Container,
  waitUntil: WaitUntil,
): Promise<Response> {
  try {
    // 🔴 İmza HAM gövde üzerinden doğrulanır — request.json() burada ÇAĞRILMAZ.
    const rawBody = await request.text()
    const envelope = await container.webhooks.verify(rawBody, request.headers.get(SIGNATURE_HEADER))

    waitUntil(
      container.webhooks.process(envelope).catch((error: unknown) => {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'bilinmeyen'
        console.error(`${LOG_PREFIX} işleme hatası type=${envelope.type} ${detail}`)
      }),
    )

    return new Response(null, { status: 202 })
  } catch (error) {
    // Geçersiz imza → 401. Platform retry'lar; kalıcı hatada teslim sağlığı düşer.
    return toErrorResponse(error, LOG_PREFIX)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleWebhook(request, buildContainer(), getExecutionContext().waitUntil)
}
