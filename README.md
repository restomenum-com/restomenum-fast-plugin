# Restomenum Eklenti Şablonu

Restomenum marketplace eklentileri için hazır başlangıç noktası.
Kurulum, imza doğrulama, ortam ayrımı ve dayanıklılık katmanı çözülmüş durumda —
sen yalnız eklentinin ne yapacağını yazarsın.

**Stack:** Next.js (App Router) · Cloudflare Workers · TypeScript strict · Drizzle · Tailwind · Vitest

---

## Neden bu şablon

Bir Restomenum eklentisinin çalışması için gereken ama yanlış yapması kolay olan şeyler
burada çözülmüş ve **canlı platforma karşı doğrulanmış** durumda:

| | |
|---|---|
| **OAuth Connect** | Tek kullanımlık `code` takası, `state` doğrulaması, credential'ların AES-GCM ile at-rest şifrelenmesi |
| **Webhook** | İmza **ham gövde** üzerinden HMAC-SHA256, replay penceresi, sabit zamanlı karşılaştırma |
| **Tekilleştirme** | Envelope `id` ile atomik sahiplenme; iş başarısız olursa sahiplenme geri verilir (olay kaybolmaz) |
| **Ortam ayrımı** | Kayıtlar `(environment, tenantId)` ile anahtarlı — sandbox ve production kimlik bilgileri birbirini **ezemez** |
| **Dayanıklılık** | Cloudflare Queues + DLQ, jitter'lı 429 backoff, dedup budama cron'u |
| **iframe Custom UI** | `frame-ancestors` CSP, App Bridge tel protokolü, session token doğrulama |
| **Çok kiracılılık** | Her sorgu tenant ile scope'lu; cross-tenant sızıntı testlerle korunuyor |

63 test bunları kapsıyor: imza (geçerli/bozuk/eski), cross-tenant, cross-environment,
`aud` reddi, `alg:none` saldırısı, dedup, retry, kuyruk tüketicisi.

---

## Hızlı başlangıç

### Claude Code ile (önerilen)

```bash
git clone <bu-repo> benim-eklentim && cd benim-eklentim
npm ci        # lockfile'daki sürümleri birebir kurar
claude
```

Claude `PROJECT.md` olmadığını görüp kurulum röportajını önerir. Ya da doğrudan:

```
/setup
```

Röportaj şunları sorar ve cevapları koda uygular: **amaç · ad/slug · veri katmanı ·
abone olunacak olaylar · panel arayüzü gerekli mi · ücretlendirme · portal kaydı.**
Portal kaydını MCP ile oluşturabilir, `client_secret`'ı `.dev.vars`'a yazar.

Depo, Restomenum geliştirici portalının MCP sunucusunu `.mcp.json` içinde tanımlar —
ilk kullanımda Claude onay ister, ardından kendi portal hesabınla OAuth ile bağlanırsın.
Salt-okunur araçlar (`get_catalog`, `get_manifest`, `validate_version` …) önceden izinli;
**scope, fiyat, manifest ya da sürüm durumunu değiştirenler her seferinde onay ister.**

### Elle

<details>
<summary>Röportaj olmadan kurmak istersen</summary>

1. **Portalda eklenti oluştur**, `client_secret` al (bir kez gösterilir).
2. **`.dev.vars`** hazırla:
   ```bash
   cp .dev.vars.example .dev.vars
   openssl rand -base64 32   # SECRET_ENCRYPTION_KEY için
   ```
   `RESTOMENUM_PLUGIN_ID`, `RESTOMENUM_CLIENT_SECRET` ve üretilen anahtarı doldur.
3. **Adları değiştir** — `package.json` ve `wrangler.jsonc` içindeki `name` **birlikte**
   (Worker adı `workers.dev` alt alan adını belirler), ayrıca `src/branding.ts`.
4. **Veritabanı:**
   ```bash
   npx wrangler d1 create <ad>          # database_id'yi wrangler.jsonc'ye yaz
   npx wrangler d1 migrations apply <ad> --local
   ```
5. **Kuyruk** (deploy öncesi):
   ```bash
   npx wrangler queues create <ad>-events
   npx wrangler queues create <ad>-events-dlq
   ```
</details>

---

## Geliştirme

```bash
npm run dev        # Next.js geliştirme sunucusu
npm run preview    # Worker paketi + wrangler dev (gerçek runtime)
npm run check      # typecheck + lint + test — commit'ten önce ZORUNLU
npm run build      # next build + Worker paketi
```

**Yerel webhook testi** için genel bir adrese ihtiyacın var:

```bash
cloudflared tunnel --url http://localhost:8787
```
Çıkan adresi portal manifest'ine `webhook_url` / `connect_url` olarak yaz.

---

## İş mantığını nereye yazarım

Olay işleyicileri `WebhookService`'e bir map olarak verilir:

```ts
// src/lib/container.ts → buildContainer(overrides)
buildContainer({
  eventHandlers: new Map([
    ['table.closed', handleTableClosed],
  ]),
})
```

`EventHandler` imzası: `(envelope, ref) => Promise<void>` — `ref` ortam + tenant taşır,
Callback API çağrısı için `installations.apiKeyFor(ref)` kullanılır.

Olay tipleri, payload şekilleri ve örnek kullanım için:
[**sample-plugin**](https://github.com/restomenum-com/plugin-sdk/tree/main/examples/sample-plugin) ·
[**dev docs**](https://dev.restomenum.com/docs)

---

## Yapı

```
src/
  app/api/          uçlar — ince: doğrula → servis → yanıt
    connect · webhook · action · hook · session/me
  app/settings/     iframe Custom UI (CSP korumalı)
  models/           saf data model — DB import ETMEZ
  services/         iş kuralı
  repositories/     SQL YALNIZ burada
  adapters/         dış sağlayıcılar (SDK bu sınıfın arkasında)
  lib/              container (DI kökü) · crypto · errors · retry · appBridge
  db/               şema + istemci
worker/index.ts     scheduled (cron) + queue handler'ları — OpenNext worker'ını sarar
```

Katman yönü tek yönlü: **route → servis → repository → DB.** Alt katman üstünü import etmez.
Ayrıntı ve gerekçeler: [`CLAUDE.md`](./CLAUDE.md).

---

## Deploy

GitHub'a push → **Cloudflare Workers Builds** derler ve yayınlar. `wrangler deploy` elle çalıştırılmaz.

| Panel ayarı | Değer |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node sürümü | 22 |

**Secret'lar runtime secret'ı olarak tanımlanmalı** (`wrangler secret put` ya da panelden
Variables and Secrets) — build ortam değişkeni olarak girilirse Worker onları göremez ve
uygulama açılışta `503 not_configured` döner.

---

## Bilinmesi gerekenler

- **`messaging:*` scope'ları platformda henüz `soon`** — mesaj gönderme yeteneği açılmadı.
- **Buton yalnız tek yuvaya** eklenebiliyor (`packet.detail.actions`); `ui:nav`, `ui:form`,
  `ui:widget` henüz canlı değil. Güncel liste için MCP `get_catalog`.
- **KV birincil depo olarak kullanılamaz** — dedup atomik sahiplenme ister, KV'de koşullu
  yazma yok ve okuma nihai tutarlı; iki eşzamanlı teslim de "ilk gören" olur.
- Şablon **D1** ile gelir; Neon ya da Durable Objects'e geçiş `src/db/` ve
  `src/repositories/D1*` dosyalarını etkiler, başka yeri etkilemez.
