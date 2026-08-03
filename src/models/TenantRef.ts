import type { Environment } from '@restomenum/plugin-sdk'

/**
 * Bir kurulumun TAM kimliği: ortam + tenant.
 *
 * 🔴 `tenantId` TEK BAŞINA kimlik DEĞİLDİR. Yayınlanmış tek bir sürüm hem sandbox
 * (dev store) hem production trafiği alır ve iki ortamın kimlik bilgileri farklıdır.
 * Yalnız tenantId ile anahtarlamak bir ortamın credential'ının diğerini ezmesine yol açar.
 *
 * İki string'i yanlış sırada geçirmeyi imkânsız kılmak için ayrı bir tip kullanılır.
 */
export interface TenantRef {
  readonly environment: Environment
  readonly tenantId: string
}

/** Cache/log anahtarı — ortam daima öne yazılır. */
export function tenantKey(ref: TenantRef): string {
  return `${ref.environment}:${ref.tenantId}`
}
