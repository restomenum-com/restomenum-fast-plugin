import type { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import type { InstallationRepository } from '@/repositories/InstallationRepository'
import { Installation } from '@/models/Installation'
import { NotFoundError } from '@/lib/errors'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

/**
 * Kurulum yaşam döngüsü: Connect → token değişimi → şifreli saklama → kaldırma.
 * Bağımlılıklar constructor'dan gelir; burada somut bağımlılık `new`'lenmez (§2.2).
 */
export class InstallationService {
  readonly #adapter: RestomenumAdapter
  readonly #repository: InstallationRepository
  readonly #encryptionKey: string
  readonly #now: () => number

  /**
   * İSTEK KAPSAMLI okuma memo'su.
   * Güvenli çünkü container her istekte yeniden kurulur — bu alan modül kapsamında
   * yaşamaz, dolayısıyla eşzamanlı istekler arasında paylaşılmaz (§2.5).
   * Tek bir istekte aynı tenant'ı 2-3 kez okumayı (imza + yetki + gövde) tek okumaya indirir.
   */
  readonly #cache = new Map<string, Installation | null>()

  constructor(params: {
    adapter: RestomenumAdapter
    repository: InstallationRepository
    encryptionKey: string
    /** Test'te sabitlenebilsin diye zaman kaynağı enjekte edilir. */
    now?: () => number
  }) {
    this.#adapter = params.adapter
    this.#repository = params.repository
    this.#encryptionKey = params.encryptionKey
    this.#now = params.now ?? (() => Date.now())
  }

  /**
   * `code`'u credential'a çevirip tenant başına ŞİFRELİ saklar.
   * Verilen `scopes` istenenin alt kümesi olabilir — dönen değer yazılır (§4.1).
   */
  async completeInstall(code: string): Promise<Installation> {
    const credentials = await this.#adapter.exchangeInstallCode(code)
    const timestamp = this.#now()

    const installation = new Installation({
      tenantId: credentials.tenantId,
      apiKey: await encryptSecret(credentials.apiKey, this.#encryptionKey),
      webhookSecret: await encryptSecret(credentials.webhookSecret, this.#encryptionKey),
      scopes: credentials.scopes,
      installedAt: timestamp,
      updatedAt: timestamp,
    })

    await this.#repository.upsert(installation)
    this.#cache.set(installation.tenantId, installation)
    return installation
  }

  /** Tek okuma noktası — aynı istek içinde tekrarlanan sorguyu (N+1) önler. */
  async #load(tenantId: string): Promise<Installation | null> {
    const cached = this.#cache.get(tenantId)
    if (cached !== undefined) return cached
    const installation = await this.#repository.findByTenantId(tenantId)
    this.#cache.set(tenantId, installation)
    return installation
  }

  /** Kurulu tenant'ın çözülmüş `webhookSecret`'i — imza ve session token doğrulaması için. */
  async webhookSecretFor(tenantId: string): Promise<string | undefined> {
    const installation = await this.#load(tenantId)
    if (installation === null) return undefined
    return decryptSecret(installation.webhookSecret, this.#encryptionKey)
  }

  /** Kurulumu getirir; yoksa NotFoundError. */
  async requireInstallation(tenantId: string): Promise<Installation> {
    const installation = await this.#load(tenantId)
    if (installation === null) {
      throw new NotFoundError('Bu tenant için kurulum bulunamadı.')
    }
    return installation
  }

  /** Çözülmüş apiKey — yalnız Callback API çağrısı yapılacağı anda üretilir, saklanmaz. */
  async apiKeyFor(tenantId: string): Promise<string> {
    const installation = await this.requireInstallation(tenantId)
    return decryptSecret(installation.apiKey, this.#encryptionKey)
  }

  /** Kurulum kaldırıldı: tenant'a ait kayıtlar silinir. */
  async removeInstall(tenantId: string): Promise<void> {
    await this.#repository.deleteByTenantId(tenantId)
    this.#cache.set(tenantId, null)
  }
}
