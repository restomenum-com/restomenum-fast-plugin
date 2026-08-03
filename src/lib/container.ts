import { loadConfig, type AppConfig } from '@/config'
import { RestomenumAdapter } from '@/adapters/RestomenumAdapter'
import { InstallationService } from '@/services/InstallationService'
import { SessionService } from '@/services/SessionService'
import { SignedRequestService } from '@/services/SignedRequestService'
import { WebhookService, type EventHandler } from '@/services/WebhookService'
import { MaintenanceService } from '@/services/MaintenanceService'
import type { InstallationRepository } from '@/repositories/InstallationRepository'
import type { EventLogRepository } from '@/repositories/EventLogRepository'
import { D1InstallationRepository } from '@/repositories/D1InstallationRepository'
import { D1EventLogRepository } from '@/repositories/D1EventLogRepository'
import { getDatabase } from '@/db/client'
import { getBindings, getExecutionContext, type Bindings } from '@/lib/bindings'
import { CloudflareEventQueue, InlineEventQueue, type EventQueue } from '@/services/EventQueue'

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
  readonly maintenance: MaintenanceService
  /** Doğrulanmış olayları dayanıklı işleme hattına verir. */
  readonly eventQueue: EventQueue
}

export interface ContainerOverrides {
  /**
   * Binding'ler. `fetch` yolunda atlanabilir (istek bağlamından okunur); `queue` ve
   * `scheduled` handler'larında ZORUNLUDUR — orada istek bağlamı yoktur.
   */
  bindings?: Bindings
  eventQueue?: EventQueue
  installationRepository?: InstallationRepository
  eventLogRepository?: EventLogRepository
  eventHandlers?: ReadonlyMap<string, EventHandler>
}

/** Veri katmanı D1'dir (§6). Testler `overrides` ile sahte repository enjekte eder. */
export function buildContainer(overrides: ContainerOverrides = {}): Container {
  const bindings = overrides.bindings ?? getBindings()
  const config = loadConfig(bindings)

  // DB yalnız gerçekten gerekliyse açılır — override verildiyse binding hiç aranmaz.
  const needsDatabase =
    overrides.installationRepository === undefined || overrides.eventLogRepository === undefined
  const db = needsDatabase ? getDatabase(bindings) : undefined

  const installationRepository =
    overrides.installationRepository ?? new D1InstallationRepository(db!)
  const eventLogRepository = overrides.eventLogRepository ?? new D1EventLogRepository(db!)

  // Ortam adapter'a örnek başına DEĞİL, çağrı başına verilir (§ ortam ayrımı).
  const adapter = new RestomenumAdapter({
    pluginId: config.pluginId,
    clientSecret: config.clientSecret,
  })

  const installations = new InstallationService({
    adapter,
    repository: installationRepository,
    encryptionKey: config.encryptionKey,
  })

  const webhooks = new WebhookService({
    installations,
    eventLog: eventLogRepository,
    fallbackEnvironment: config.environment,
    ...(overrides.eventHandlers !== undefined ? { handlers: overrides.eventHandlers } : {}),
  })

  // Kuyruk binding'i varsa dayanıklı hat; yoksa waitUntil'a düşer ve UYARIR.
  const queueBinding = bindings.EVENT_QUEUE
  const eventQueue: EventQueue =
    overrides.eventQueue ??
    (queueBinding !== undefined
      ? new CloudflareEventQueue(queueBinding)
      : new InlineEventQueue({
          run: (event) => webhooks.process(event),
          waitUntil: (promise) => getExecutionContext().waitUntil(promise),
        }))

  return {
    config,
    eventQueue,
    installations,
    sessions: new SessionService({
      installations,
      pluginId: config.pluginId,
      fallbackEnvironment: config.environment,
    }),
    signedRequests: new SignedRequestService({
      installations,
      fallbackEnvironment: config.environment,
    }),
    maintenance: new MaintenanceService({ eventLog: eventLogRepository }),
    webhooks,
  }
}
