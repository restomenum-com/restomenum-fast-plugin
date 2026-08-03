import type { Environment } from '@restomenum/plugin-sdk'

import type { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import type { InstallationRepository } from '@/repositories/InstallationRepository'
import { Installation } from '@/models/Installation'
import { type TenantRef, tenantKey } from '@/models/TenantRef'
import { NotFoundError } from '@/lib/errors'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

/**
 * Kurulum yaşam döngüsü: Connect → token değişimi → şifreli saklama → kaldırma.
 * Bağımlılıklar constructor'dan gelir (§2.2).
 *
 * 🔴 Her işlem ORTAM ile scope'lanır — `tenantId` tek başına kimlik değildir.
 */
export class InstallationService {
  readonly #adapter: RestomenumAdapter
  readonly #repository: InstallationRepository
  readonly #encryptionKey: string
  readonly #now: () => number

  /**
   * İSTEK KAPSAMLI okuma memo'su (anahtar: ortam+tenant).
   * Güvenli çünkü container her istekte yeniden kurulur — modül kapsamında yaşamaz (§2.5).
   */
  readonly #cache = new Map<string, Installation | null>()

  constructor(params: {
    adapter: RestomenumAdapter
    repository: InstallationRepository
    encryptionKey: string
    now?: () => number
  }) {
    this.#adapter = params.adapter
    this.#repository = params.repository
    this.#encryptionKey = params.encryptionKey
    this.#now = params.now ?? (() => Date.now())
  }

  /**
   * `code`'u credential'a çevirip ORTAM + tenant başına ŞİFRELİ saklar.
   * Verilen `scopes` istenenin alt kümesi olabilir — dönen değer yazılır (§4.1).
   */
  async completeInstall(code: string, environment: Environment): Promise<Installation> {
    const credentials = await this.#adapter.exchangeInstallCode(code, environment)
    const timestamp = this.#now()

    const installation = new Installation({
      environment,
      tenantId: credentials.tenantId,
      apiKey: await encryptSecret(credentials.apiKey, this.#encryptionKey),
      webhookSecret: await encryptSecret(credentials.webhookSecret, this.#encryptionKey),
      scopes: credentials.scopes,
      installedAt: timestamp,
      updatedAt: timestamp,
    })

    await this.#repository.upsert(installation)
    this.#cache.set(tenantKey(installation.ref), installation)
    return installation
  }

  /** Tek okuma noktası — aynı istek içinde tekrarlanan sorguyu (N+1) önler. */
  async #load(ref: TenantRef): Promise<Installation | null> {
    const key = tenantKey(ref)
    const cached = this.#cache.get(key)
    if (cached !== undefined) return cached
    const installation = await this.#repository.findByRef(ref)
    this.#cache.set(key, installation)
    return installation
  }

  /** Kurulu tenant'ın çözülmüş `webhookSecret`'i — imza doğrulaması için. */
  async webhookSecretFor(ref: TenantRef): Promise<string | undefined> {
    const installation = await this.#load(ref)
    if (installation === null) return undefined
    return decryptSecret(installation.webhookSecret, this.#encryptionKey)
  }



  /** Kurulumu getirir; yoksa NotFoundError. */
  async requireInstallation(ref: TenantRef): Promise<Installation> {
    const installation = await this.#load(ref)
    if (installation === null) {
      throw new NotFoundError('Bu tenant için kurulum bulunamadı.')
    }
    return installation
  }

  /** Çözülmüş apiKey — yalnız Callback API çağrısı anında üretilir, saklanmaz. */
  async apiKeyFor(ref: TenantRef): Promise<string> {
    const installation = await this.requireInstallation(ref)
    return decryptSecret(installation.apiKey, this.#encryptionKey)
  }

  /** Kurulum kaldırıldı: O ORTAMDAKİ tenant kayıtları silinir. */
  async removeInstall(ref: TenantRef): Promise<void> {
    await this.#repository.deleteByRef(ref)
    this.#cache.set(tenantKey(ref), null)
  }
}
