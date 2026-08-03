import { and, eq } from 'drizzle-orm'
import type { Environment, Scope } from '@restomenum/plugin-sdk'

import type { Database } from '@/db/client'
import { installations } from '@/db/schema'
import { Installation } from '@/models/Installation'
import type { TenantRef } from '@/models/TenantRef'
import type { InstallationRepository } from '@/repositories/InstallationRepository'

type Row = typeof installations.$inferSelect

/** Kurulum kayıtlarının D1 implementasyonu. SQL YALNIZ burada yaşar (§2.2). */
export class D1InstallationRepository implements InstallationRepository {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Alan alan açık dönüşüm — spread ile gevşek kopyalama yok (§2.4). */
  #toModel(row: Row): Installation {
    return new Installation({
      environment: row.environment as Environment,
      tenantId: row.tenantId,
      apiKey: row.apiKey,
      webhookSecret: row.webhookSecret,
      scopes: JSON.parse(row.scopes) as Scope[],
      installedAt: row.installedAt,
      updatedAt: row.updatedAt,
    })
  }

  async findByRef(ref: TenantRef): Promise<Installation | null> {
    const rows = await this.#db
      .select()
      .from(installations)
      .where(
        and(
          eq(installations.environment, ref.environment),
          eq(installations.tenantId, ref.tenantId),
        ),
      )
      .limit(1)

    const row = rows[0]
    return row === undefined ? null : this.#toModel(row)
  }


  /**
   * İdempotent upsert. Çakışma hedefi ORTAM + TENANT bileşiğidir — yalnız tenantId
   * hedeflenirse bir ortamın credential'ı diğerini ezer.
   * Yeniden kurulumda `installed_at` korunur, credential'lar tazelenir.
   */
  async upsert(installation: Installation): Promise<void> {
    await this.#db
      .insert(installations)
      .values({
        environment: installation.environment,
        tenantId: installation.tenantId,
        apiKey: installation.apiKey,
        webhookSecret: installation.webhookSecret,
        scopes: JSON.stringify(installation.scopes),
        installedAt: installation.installedAt,
        updatedAt: installation.updatedAt,
      })
      .onConflictDoUpdate({
        target: [installations.environment, installations.tenantId],
        set: {
          apiKey: installation.apiKey,
          webhookSecret: installation.webhookSecret,
          scopes: JSON.stringify(installation.scopes),
          updatedAt: installation.updatedAt,
        },
      })
  }

  async deleteByRef(ref: TenantRef): Promise<void> {
    await this.#db
      .delete(installations)
      .where(
        and(
          eq(installations.environment, ref.environment),
          eq(installations.tenantId, ref.tenantId),
        ),
      )
  }
}
