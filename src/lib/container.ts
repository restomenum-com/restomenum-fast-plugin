import { loadConfig, type AppConfig } from '@/config'
import { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import { InstallationService } from '@/services/InstallationService'
import { SessionService } from '@/services/SessionService'
import { SignedRequestService } from '@/services/SignedRequestService'
import { WebhookService, type EventHandler } from '@/services/WebhookService'
import {
  UnconfiguredInstallationRepository,
  type InstallationRepository,
} from '@/repositories/InstallationRepository'
import {
  UnconfiguredEventLogRepository,
  type EventLogRepository,
} from '@/repositories/EventLogRepository'

/**
 * Kompozisyon kökü — bağımlılıklar YALNIZ burada kurulur (§2.2).
 *
 * 🔴 Container İSTEK BAŞINA üretilir ve modül kapsamında CACHE'LENMEZ.
 * workerd isolate'ı istekler arası yaşar ve eşzamanlı istekleri aynı isolate işleyebilir;
 * tenant'a bağlı hiçbir şey paylaşılan kapsamda tutulamaz (§2.5).
 */
export interface Container {
  readonly config: AppConfig
  readonly installations: InstallationService
  readonly sessions: SessionService
  readonly signedRequests: SignedRequestService
  readonly webhooks: WebhookService
}

export interface ContainerOverrides {
  installationRepository?: InstallationRepository
  eventLogRepository?: EventLogRepository
  eventHandlers?: ReadonlyMap<string, EventHandler>
}

/**
 * Veritabanı seçildiğinde (§6) buradaki iki `Unconfigured…` yerine somut Drizzle
 * repository'leri geçilir — başka hiçbir dosya değişmez.
 */
export function buildContainer(overrides: ContainerOverrides = {}): Container {
  const config = loadConfig()

  const installationRepository =
    overrides.installationRepository ?? new UnconfiguredInstallationRepository()
  const eventLogRepository = overrides.eventLogRepository ?? new UnconfiguredEventLogRepository()

  const adapter = new RestomenumAdapter({
    environment: config.environment,
    pluginId: config.pluginId,
    clientSecret: config.clientSecret,
  })

  const installations = new InstallationService({
    adapter,
    repository: installationRepository,
    encryptionKey: config.encryptionKey,
  })

  return {
    config,
    installations,
    sessions: new SessionService({ installations, pluginId: config.pluginId }),
    signedRequests: new SignedRequestService({ installations }),
    webhooks: new WebhookService({
      installations,
      eventLog: eventLogRepository,
      ...(overrides.eventHandlers !== undefined ? { handlers: overrides.eventHandlers } : {}),
    }),
  }
}
