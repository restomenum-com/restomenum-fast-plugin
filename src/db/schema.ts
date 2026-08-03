import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * D1 (SQLite) şeması.
 * Dialect kararı CLAUDE.md §6 uyarınca D1'dir.
 *
 * 🔴 Her tablo ORTAM ile anahtarlanır. Tek yayınlanmış sürüm hem sandbox (dev store)
 * hem production trafiği alır; ortamların kimlik bilgileri ayrıdır ve karışmamalıdır.
 */

/** Tenant başına kurulum. `api_key` ve `webhook_secret` ŞİFRELİ saklanır (§4.1). */
export const installations = sqliteTable(
  'installations',
  {
    /** 'sandbox' | 'production' — imzalı gövdeden gelir, header'dan DEĞİL. */
    environment: text('environment').notNull(),
    tenantId: text('tenant_id').notNull(),
    apiKey: text('api_key').notNull(),
    webhookSecret: text('webhook_secret').notNull(),
    /** JSON dizi olarak scope listesi — SQLite'ta array tipi yoktur. */
    scopes: text('scopes').notNull(),
    /** Epoch milisaniye, UTC (§2.4). */
    installedAt: integer('installed_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.tenantId] }),
  ],
)

/**
 * Olay tekilleştirme. Teslim at-least-once ve sırasızdır (§4.2).
 * 🔴 Bileşik primary key ZORUNLU — dedup `ON CONFLICT DO NOTHING` ile çalışır ve bu
 * ancak gerçek bir unique kısıt varsa tetiklenir. Düz index yeterli DEĞİLDİR.
 */
export const seenEvents = sqliteTable(
  'seen_events',
  {
    environment: text('environment').notNull(),
    tenantId: text('tenant_id').notNull(),
    eventId: text('event_id').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.tenantId, table.eventId] }),
    // Budama sorgusu bu kolona göre filtreler (§2.6 saklama politikası).
    index('seen_events_seen_at_idx').on(table.seenAt),
  ],
)
