#!/usr/bin/env node
/**
 * Deploy sonrası duman testi — go-live listesindeki maddenin çalıştırılabilir hali.
 *
 * Yalnız DIŞARIDAN gözlemlenebilen davranışı sınar; kurulum ya da secret gerektirmez.
 * Amacı "her şey doğru" demek değil, **açıkça yanlış olanı** yakalamak:
 * yayına çıkmış ama CSP'si eksik bir iframe, imzasız isteği kabul eden bir webhook.
 *
 * Kullanım:  npm run smoke -- https://<worker>.workers.dev
 */

const PANEL_ORIGINS = ['https://app.restomenum.com', 'https://test-restomenu.web.app']
const TIMEOUT_MS = 20_000

const baseUrl = process.argv[2]?.replace(/\/$/, '')
if (!baseUrl) {
  console.error('Kullanım: npm run smoke -- https://<adres>')
  process.exit(1)
}

let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

console.log(`\nDuman testi: ${baseUrl}\n`)

try {
  console.log('erişilebilirlik')
  const installed = await request('/installed')
  check('/installed yanıt veriyor', installed.status === 200, `HTTP ${installed.status}`)

  console.log('\niframe güvenliği')
  const settings = await request('/settings')
  const csp = settings.headers.get('content-security-policy') ?? ''
  check(
    'frame-ancestors iki panel origin\'ini de içeriyor',
    PANEL_ORIGINS.every((origin) => csp.includes(origin)),
    csp || 'CSP başlığı yok',
  )
  check('wildcard/none kullanılmamış', !/frame-ancestors[^;]*(\*|'none')/.test(csp))
  check(
    'X-Frame-Options konmamış (CSP ile çakışır)',
    settings.headers.get('x-frame-options') === null,
    settings.headers.get('x-frame-options') ?? '',
  )

  console.log('\nimza yüzeyi')
  const unsigned = await request('/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'smoke', type: 'table.created', environment: 'sandbox', tenantId: 'x' }),
  })
  check('imzasız webhook reddediliyor', unsigned.status === 401, `HTTP ${unsigned.status}`)

  const badSignature = await request('/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-restomenum-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify({ id: 'smoke', type: 'table.created', environment: 'sandbox', tenantId: 'x' }),
  })
  check('bozuk imzalı webhook reddediliyor', badSignature.status === 401, `HTTP ${badSignature.status}`)

  const noToken = await request('/api/session/me')
  check('tokensız oturum ucu reddediliyor', noToken.status === 401, `HTTP ${noToken.status}`)

  console.log('\nsızıntı')
  const body = await noToken.text()
  check(
    '401 yanıtı secret/anahtar sızdırmıyor',
    !/secret|apikey|cs_[A-Za-z0-9_-]{10,}/i.test(body),
    body.slice(0, 80),
  )
} catch (error) {
  console.log(`\n✗ İstek başarısız: ${error instanceof Error ? error.message : error}`)
  failed++
}

console.log(`\n${passed} geçti · ${failed} kaldı\n`)

if (failed > 0) {
  console.log('Not: yapılandırma eksikse uçlar 503 döner — secret\'ların Worker secret\'ı')
  console.log('olarak tanımlandığını doğrula (build ortam değişkeni olarak DEĞİL).\n')
}

process.exit(failed > 0 ? 1 : 0)
