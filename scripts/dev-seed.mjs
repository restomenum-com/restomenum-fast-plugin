#!/usr/bin/env node
/**
 * Yerel D1'e sahte bir kurulum kaydı yazar.
 *
 * Neden: handler geliştirmek için veritabanında bir kurulum olmak zorunda — imza
 * doğrulaması tenant'ın `webhookSecret`'ini oradan çözüyor. Gerçek bir mağazaya kurulum
 * yapmadan çalışabilmek için bu fixture gerekir.
 *
 * 🔴 YALNIZ YEREL. Uzak veritabanına yazmaz; `--remote` gibi bir seçenek bilerek yok.
 * Yazdığı secret uydurmadır, gerçek bir kurulumun secret'ı DEĞİLDİR.
 *
 * Kullanım:
 *   npm run dev:seed
 *   npm run dev:seed -- --tenant magaza-1 --env production
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ENCRYPTION_KEY_BYTES = 32
const IV_BYTES = 12

/** Şifreleme biçimi `src/lib/crypto.ts` ile AYNI olmak zorunda: base64url(iv).base64url(ct) */
async function encrypt(plaintext, base64Key) {
  const raw = Buffer.from(base64Key, 'base64')
  if (raw.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`SECRET_ENCRYPTION_KEY ${ENCRYPTION_KEY_BYTES} bayt olmalı, ${raw.length} geldi`)
  }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(plaintext))
  return `${Buffer.from(iv).toString('base64url')}.${Buffer.from(new Uint8Array(ct)).toString('base64url')}`
}

function readDevVar(name) {
  let contents
  try {
    contents = readFileSync('.dev.vars', 'utf8')
  } catch {
    throw new Error('.dev.vars bulunamadı — önce `cp .dev.vars.example .dev.vars` ve doldur.')
  }
  const match = contents.match(new RegExp(`^${name}\\s*=\\s*"?([^"\\n]*)"?`, 'm'))
  if (!match?.[1]) throw new Error(`.dev.vars içinde ${name} boş ya da yok.`)
  return match[1]
}

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : fallback
}

function databaseName() {
  const config = readFileSync('wrangler.jsonc', 'utf8').replace(/\/\/.*$/gm, '')
  const name = JSON.parse(config).d1_databases?.[0]?.database_name
  if (!name) throw new Error('wrangler.jsonc içinde d1_databases tanımlı değil.')
  return name
}

const environment = arg('--env', 'sandbox')
const tenantId = arg('--tenant', 'dev-tenant')
const webhookSecret = arg('--secret', 'dev-webhook-secret')

if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`--env yalnız "sandbox" veya "production" olabilir (geldi: ${environment})`)
  process.exit(1)
}

const encryptionKey = readDevVar('SECRET_ENCRYPTION_KEY')
const now = Date.now()
const sql = `INSERT OR REPLACE INTO installations
  (environment, tenant_id, api_key, webhook_secret, scopes, installed_at, updated_at)
  VALUES ('${environment}', '${tenantId}',
          '${await encrypt('dev-api-key', encryptionKey)}',
          '${await encrypt(webhookSecret, encryptionKey)}',
          '["orders:read","events:subscribe"]', ${now}, ${now});`

execFileSync('npx', ['wrangler', 'd1', 'execute', databaseName(), '--local', '--command', sql], {
  stdio: ['ignore', 'ignore', 'inherit'],
})

console.log(`
✓ Yerel kurulum yazıldı

  ortam          ${environment}
  tenantId       ${tenantId}
  webhookSecret  ${webhookSecret}

Bu secret ile imzalı test isteği üretebilirsin — ama unutma: kendi imzaladığın bir
istek DOĞRULAMA değildir (CLAUDE.md §2.7). Gerçek akışı gerçek bir kurulumla sına.
`)
