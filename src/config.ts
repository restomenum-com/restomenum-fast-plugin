import { z } from 'zod'
import { PANEL_ORIGINS, SIGNATURE_TOLERANCE_SEC } from '@restomenum/plugin-sdk'
import type { Environment } from '@restomenum/plugin-sdk'

import { ConfigError } from '@/lib/errors'
import { getBindings } from '@/lib/bindings'

/**
 * Ortam değişkenlerinin TEK okuma noktası.
 * Başka hiçbir modül binding'e ya da process.env'e doğrudan erişmez (§2.6).
 */

/** Panelin iframe'i çerçevelediği origin'ler — CSP ve postMessage allowlist'i. SDK kaynaklı. */
export { PANEL_ORIGINS, SIGNATURE_TOLERANCE_SEC }

/** Connect akışındaki `state` parametresinin geçerlilik süresi. */
export const CONNECT_STATE_TTL_SECONDS = 600

/** Şifreleme anahtarının çözülmüş uzunluğu (AES-256 → 32 bayt). */
export const ENCRYPTION_KEY_BYTES = 32

const configSchema = z.object({
  /** Portaldaki eklenti kimliği; session token `aud` bununla karşılaştırılır. */
  pluginId: z.string().min(1, 'RESTOMENUM_PLUGIN_ID tanımlı değil'),
  /** Yalnız server-to-server token değişiminde kullanılır — istemciye asla gitmez. */
  clientSecret: z.string().min(1, 'RESTOMENUM_CLIENT_SECRET tanımlı değil'),
  /** Callback/OAuth API kökünü belirler. */
  environment: z.enum(['sandbox', 'production']),
  /** Install credential'larını at-rest şifrelemek için base64 kodlu 32 baytlık anahtar. */
  encryptionKey: z.string().min(1, 'SECRET_ENCRYPTION_KEY tanımlı değil'),
})

export type AppConfig = z.infer<typeof configSchema> & { environment: Environment }

/**
 * Binding'lerden config üretir ve doğrular.
 * Kritik değişken eksikse ConfigError fırlatır → uç 503 döner (sessiz bozulma yasak).
 */
export function loadConfig(): AppConfig {
  const bindings = getBindings()

  const result = configSchema.safeParse({
    pluginId: bindings.RESTOMENUM_PLUGIN_ID,
    clientSecret: bindings.RESTOMENUM_CLIENT_SECRET,
    environment: bindings.RESTOMENUM_ENVIRONMENT ?? 'sandbox',
    encryptionKey: bindings.SECRET_ENCRYPTION_KEY,
  })

  if (!result.success) {
    // Değerleri DEĞİL yalnız eksik alan adlarını sızdır.
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new ConfigError(`Eksik veya geçersiz yapılandırma: ${fields}`)
  }

  return result.data
}
