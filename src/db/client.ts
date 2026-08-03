import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'

import * as schema from '@/db/schema'
import { ConfigError } from '@/lib/errors'
import type { Bindings } from '@/lib/bindings'

/** Drizzle + D1 istemcisi. Binding yoksa sessizce değil AÇIKÇA hata verir (§2.6). */
export type Database = DrizzleD1Database<typeof schema>

export function getDatabase(bindings: Bindings): Database {
  const binding = bindings.DB
  if (binding === undefined || binding === null) {
    throw new ConfigError('D1 binding (DB) tanımlı değil — wrangler.jsonc d1_databases.')
  }
  return drizzle(binding as D1Database, { schema })
}
