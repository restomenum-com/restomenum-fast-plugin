import { buildContainer, type Container } from '@/lib/container'
import { toErrorResponse } from '@/lib/errors'

/**
 * iframe'in çağırdığı örnek uç — session token ile korunur.
 * 🔴 `tenantId` ve `role` YALNIZ doğrulanmış claim'lerden okunur (§4.3).
 */

const LOG_PREFIX = 'session:'

export async function handleSessionMe(request: Request, container: Container): Promise<Response> {
  try {
    const claims = await container.sessions.authenticate(request.headers.get('authorization'))
    const installation = await container.installations.requireInstallation(claims.tenantId)

    // Alan alan açık dönüşüm — model doğrudan serileştirilmez (§2.4).
    return Response.json({
      user: { id: claims.sub, role: claims.role },
      installation: installation.toDto(),
    })
  } catch (error) {
    return toErrorResponse(error, LOG_PREFIX)
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleSessionMe(request, buildContainer())
}
