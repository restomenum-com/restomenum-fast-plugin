

# CLAUDE.md — Restomenum eklenti geliştirme kuralları

Bu dosya eklenti kod tabanına özgü değildir; her Restomenum eklentisi için geçerli çalışma
kurallarını içerir. Eklentinin **amacı ve kapsamı projeden projeye değişir** — buraya yalnız
her eklentide geçerli olan kurallar yazılır.

🔴 **`PROJECT.md` yoksa bu depo henüz yapılandırılmamış bir ŞABLONDUR.**
Kod yazmadan önce `/setup` kurulum röportajını çalıştır — ad, veri katmanı ve portal kimliği
sorulmadan yazılan kod yer tutucu değerlerle çalışır ve ilk istekte `503 not_configured` döner.
Kullanıcı başka bir iş isterse bunu bir cümleyle hatırlat; ısrar ederse devam et.

🔴 **Her eklenti çok kiracılıdır (multi-tenant).** Her tenant'ın kendi `apiKey` / `webhookSecret` /
ayarları vardır; bir tenant'ın verisinin diğerine sızması bu kod tabanındaki **en kritik hata
sınıfıdır**. Her sorgu, her cache anahtarı ve her log satırı tenant ile scope'lanır.

---

## 1. Stack ve runtime (SABİT — değiştirmeden önce sor)

| Katman | Seçim |
|---|---|
| Dil | **TypeScript strict** — `tsc --noEmit` ile tip denetimi |
| Framework | **Next.js App Router** (Pages Router kullanılmaz) |
| Runtime | **Cloudflare Workers (workerd)** — `@opennextjs/cloudflare` adaptörü |
| Deploy | **GitHub push → Workers Builds** (Cloudflare git entegrasyonu) |
| DB | **Neon Postgres** *veya* **Cloudflare D1** — proje ihtiyacına göre seçilir (§6) |
| ORM | **Drizzle** — `drizzle-orm/neon-http` ya da `drizzle-orm/d1` |
| Doğrulama | **zod** |
| Dosya/görsel | **Cloudflare R2** (dosya) + **Cloudflare Images** (görsel) |
| Restomenum | **`@restomenum/plugin-sdk`** |
| Arayüz | **Tailwind CSS** + `next/font` (§2.8) |
| Test | **Vitest** |

## 2. Genel mühendislik kuralları

### 2.1 Tipler ve kod
- TypeScript **strict**. Kaçış tipi **`any` YASAK** — bilinmeyen için `unknown` + daraltma.
- Tanımlayıcılar (değişken/fonksiyon/sınıf) **İngilizce**; **yorumlar ve kullanıcıya görünen
  metinler Türkçe** (bu projenin yerleşik konvansiyonu — kök kuraldan bilinçli sapma).
- **Magic string/number yasak.** Sabitler isimlendirilir: modül üstünde `const` ya da `config.ts`.
  (`300` değil `SIGNATURE_TOLERANCE_SECONDS`, `"manager"` değil `Role.Manager`.)
  ↳ Tek yerde geçen ve bağlamdan apaçık olan değer için zorlama.
- Her dosya **tek sorumluluk**. Açıklık > "akıllı" kısayol.
- Derin `../../../` import zinciri yasak.
  ↳ **Bu projede `@/*` path alias'ı AÇIKTIR** (`tsconfig.json` paths). Kök standartta alias
  "sığ ağaçta gereksiz" diye elenmişti; Next.js App Router ağacı sığ değil, gerekçe düşüyor.

### 2.2 Mimari ve OOP
- **Katman tek yönlü:** `route (app/api/**) → servis → repository → DB`. Alt katman üstünü
  **import ETMEZ**; **SQL yalnız `repositories/` içinde**. Route ince: doğrula → servis → yanıt.
- Bağımlılıklar **constructor'dan enjekte** edilir (kompozisyon kökü `lib/container.ts`);
  sınıf içinde somut bağımlılık `new`'lenmez — test sahte enjekte eder.
- Durum/polimorfizm taşıyan birim **sınıf**, saf yardımcı **fonksiyon** kalır.
- Dış sağlayıcılar (Restomenum ve eklentinin bağlandığı servisler) **adapter arkasında**;
  sağlayıcı detayı (auth, hata formatı, alan adları) dışarı sızmaz.
- **ERKEN SOYUTLAMA YAPMA** — ikinci somut örnek gelmeden hiyerarşi/registry kurma.
- **OOP fırsatı görünce büyük refactor'a girme, önce SOR:** *"`class X` olarak modelleyebilirim,
  ister misin?"*

### 2.3 Dosyalama ve temizlik
- Bir dosya tek iş yapar; **~300 satırı aşarsa bölmeyi öner**. Dosya adı içeriğini anlatır.
- **Model ↔ Repository (ZORUNLU):** `models/<X>.ts` saf data model — **DB import ETMEZ, sorgu
  çalıştırmaz**; `repositories/<X>Repository.ts` tüm SQL'i taşır, dışa `toDto()` ile verir.
- Sınıflar katman klasörlerinde (`models/ services/ repositories/ adapters/`), feature'a gömülmez.
- Helper kullanıldığı yere yakın durur; **ikinci kullanıcı çıkınca** `lib/utils/`'e taşınır (YAGNI).
- Ölü kod, kullanılmayan import, yoruma alınmış eski kod **silinir**.
- 3+ seviye nesting → erken `return`. Yorum yazmak yerine **ismi düzelt**.

### 2.4 Veri ve doğrulama
- Dış girdi **zod** ile doğrulanır; TypeScript tipi **aynı şemadan türetilir** (`z.infer`).
  Girdi kapsamı: webhook gövdesi, action/hook payload'ı, iframe'den gelen istekler, env.
- **İç model dış arayüze DOĞRUDAN dönülmez.** Alan alan açık dönüşüm yazılır (`toDto()`).
  **Spread ile gevşek kopyalama yasak** — sonradan eklenen bir alan (secret, PII) sessizce sızar.
- Girdi iç modele **whitelist** ile yazılır; gelen objeyi olduğu gibi upsert etme.
- **Para hesapları kuruş-tamsayı** üzerinden yapılır (monetization / IAP tutarları).
  Float ile para aritmetiği **yasak**.
- **Zaman UTC/epoch saklanır**; yalnız gösterim sınırında (iframe UI) lokalize edilir.

### 2.5 Async, hata, eşzamanlılık (workerd'e özgü)
- Bağımsız işler **paralel** (`Promise.all`). Bağımlı zincirleri paralelleştirme.
- Yalnız **`Error` türevi** fırlatılır. Hata yanıtları **tek merkezden** üretilir
  (`lib/errors.ts` + ortak handler); uçlar kendi formatını uydurmaz.
- 🔴 **İstek-bazlı durum ASLA modül/global kapsamda tutulmaz.** workerd isolate'ı istekler
  arası yaşar ve **eşzamanlı istekleri aynı isolate işleyebilir**.
  Modül kapsamında yalnız: değişmez sabitler + istekten bağımsız paylaşılabilir kaynaklar
  (DB client, SDK istemcisi, token cache).
- 🔴 **Paylaşılan mutable yapı (ör. tenant→istemci cache'i) istek verisi TAŞIYAMAZ.**
  Cache'in değeri yalnız tenant'a bağlı ve istekten bağımsız olmalı.
- `tenantId`, kullanıcı, request context **parametre olarak** taşınır — modül değişkeni,
  singleton alanı veya örtük kanal kullanılmaz.

### 2.6 Config, log, dayanıklılık
- Env **yalnız `config.ts`**'te okunur, açılışta zod ile doğrulanır; kritik eksikte **açık 503** —
  sessiz bozulma yasak.
- 🔴 **Secret ve PII loglanmaz** (`client_secret`, `apiKey`, `webhookSecret`, session token,
  connection string; müşteri/personel adı, telefon, e-posta, sipariş ve mesaj içeriği).
  Gerekiyorsa maskele (`+9053*****42`).
- Log önekleri tutarlı: `webhook:` `oauth:` `hook:` `action:` `429:`. Korelasyon için olay/istek
  id'si her satıra taşınır.
- Dış çağrıda **timeout + sınırlı retry**; kritik akışta **idempotency ZORUNLU**
  (deterministik id + `seen_events` dedup).
- Büyüyen tablolar (`seen_events`, olay/istek logu) budanır, PII minimum süre tutulur;
  R2/Images'ta sahipsiz nesne bırakılmaz.

### 2.7 Test ve doğrulama
- **Yeni davranış = yeni test.** Asgari kapsam: imza (geçerli/bozuk/süresi geçmiş), dedup,
  session token `aud` reddi, tenant izolasyonu, kuruş aritmetiği, hata yolları.
- `lib/utils/` yalnız saf, domain'siz fonksiyon içerir; iş kuralı servise aittir.
- 🔴 **Test geçmesi "çalışıyor" demeye yetmez.** Bir akışı doğrularken **gerçek tetikleyici**
  kullan: gerçek kurulum/kaldırma, gerçek webhook, gerçek ödeme, gerçek deploy edilmiş uç.
  Payload'ı elle kurup kendi secret'ınla imzalayıp kendine POST etmek **doğrulama DEĞİLDİR** —
  yalnız kendi fonksiyonunu kendine doğrular, gerçek üreticinin formatını/zamanlamasını değil.
- Gerçek tetik gerçek aksiyon istiyorsa (ödeme, iptal, kaldırma) → **kullanıcıdan iste.**
- 🔴 Denenmemiş kısmı **dürüstçe söyle**: *"kod bağlı ama gerçek tetikle denenmedi"*.

### 2.8 Arayüz ve tasarım
- **Tailwind CSS zorunlu.** Inline `style` ve ayrı `.css` dosyası yazılmaz; istisna, Tailwind'in
  ifade edemediği tek seferlik değerlerdir (o da CSS değişkeniyle).
- **Renk/ölçü değerleri sınıflara dağıtılmaz** — `globals.css` içindeki `@theme` bloğunda
  belirteç olarak tanımlanır (`--color-brand-*`, `--radius-panel`). Magic değer yasağı (§2.1) burada da geçerli.
- **Açık ve koyu tema İKİSİ birden desteklenir.** Panel eklentiyi her iki temada çerçeveleyebilir;
  yalnız birine göre tasarlanan ekran diğerinde okunmaz hale gelir.
- **2026 modern estetiği:** cömert boşluk, net tipografik hiyerarşi, yumuşak derinlik
  (`backdrop-blur`, düşük opaklıkta kenarlık), `text-balance`/`text-pretty`, `tabular-nums`,
  ölçü birimi olarak `dvh`. Dekoratif hareket ve gradyan **az** kullanılır — arayüz sakin durur.
- **Erişilebilirlik pazarlık konusu değil:** yeterli kontrast, `aria-*` ve rol'ler, klavyeyle
  gezilebilirlik, `prefers-reduced-motion` desteği (globals.css'te tanımlı).
- 🔴 **Dış kaynak YÜKLENMEZ** — CDN script'i, uzak font, uzak görsel yok. Yazı tipleri `next/font`
  ile derleme anında indirilip kendi origin'imizden sunulur; aksi halde iframe'de CSP'ye takılır
  ve her istekte Worker alt-istek bütçesi harcanır.
- **Yükleniyor/boş/hata durumları tasarlanır**, sonradan eklenmez. Ham hata metni kullanıcıya
  gösterilmez; ne olduğu ve ne yapılacağı yazılır.
- iframe sayfaları panel dışında da açılabilir — o durumda hata değil, **açıklama** gösterilir
  (`isEmbedded()`).
---

## 3. Git ve deploy akışı

- **Her mantıksal değişiklikten sonra commit** — biriktirme yok; bir commit birden çok dosya içerebilir.
- **Yalnız kendi değiştirdiğin dosyalar girer.** `git add <dosya1> <dosya2>` —
  `git add -A`, `git add .`, `git commit -a` **YASAK**. Commit'i **pathspec ile** at:
  `git commit -m "..." -- <yol1> <yol2>` — yoksa başka bir aracın önceden stage'lediği
  ilgisiz dosyalar da commit'e girer.
- **Kontrol commit'ten AYRI adımda:** önce `git diff --cached --stat` çalıştır, beklenmeyen
  dosya var mı bak, sonra commit et. Aynı komutta zincirleme.
- **Commit mesajı:** Türkçe, kısa, **ne + neden** —
  `webhook: imza ham gövdeden doğrulanıyor — re-stringify geçerli istekleri 401 yapıyordu`
- **Commit'ten önce `npm run check` (typecheck + lint + test) geçmeli.**
  Push = deploy (GitHub → Workers Builds),
  `wrangler deploy` elle kullanılmaz; **`main` her zaman deploy edilebilir olmalı.**
- 🔴 **Secret ASLA commit edilmez** (`.env`, `.dev.vars`, anahtar/şifre). Prod secret'ları
  `wrangler secret put` ile. Stage'lenmiş secret görülürse: **commit iptal + rotasyon**.
- **`git push`, tag, release, `reset --hard`, `push --force` → kullanıcı istemeden yapılmaz.**
- **`package-lock.json` COMMIT EDİLİR, elle düzenlenmez.** Onsuz her CI derlemesi paketleri
  yeniden çözer (tekrarlanabilirlik gider) ve integrity hash'leri kaybolur (tedarik zinciri riski).
  Güncelleme `npm update` ile yapılır, çıkan lockfile commit'lenir.
- Yeni bağımlılıkta **workerd uyumluluğu ön koşuldur**; mevcut paket işi görüyorsa yenisi eklenmez.

---

## 4. Restomenum eklenti kuralları

### 4.1 Kimlik ve kurulum
1. Tenant kurar → `/connect`'e `code` + `state` ile yönlenir; **`state` doğrulanır** (CSRF).
2. Sunucudan sunucuya token değişimi: `POST /plugin-api/oauth/token`
   `{ grant_type: "authorization_code", code, client_id, client_secret }`
3. Dönen `tenantId` / `apiKey` / `webhookSecret` / `scopes` **tenant başına şifreli** saklanır
   (`lib/crypto.ts`). Sonraki tüm imza ve session token doğrulamaları bu `webhookSecret`'e dayanır.
- 🔴 **`client_secret` yalnız bu server-to-server çağrıda kullanılır** — istemciye/iframe'e gitmez.
- `code` **tek kullanımlıktır**; değişim başarısızsa Connect akışı baştan başlar.
- Verilen `scopes` istenenin **alt kümesi olabilir** — kod istediğine değil, dönene bakar.
- Kurulum kaldırıldığında (uninstall) tenant kayıtları ve o tenant'a ait yüklenmiş nesneler silinir.

### 4.2 Webhook imzası — `X-Restomenum-Signature`
- Format: `t=<unixSec>,v1=<hex>`
- İmzalanan veri: `"<t>." + rawBody` — **bayt bazında ham gövde**
- **HMAC-SHA256**, anahtar = o tenant'ın `webhookSecret`'i
- Karşılaştırma **timing-safe** (`crypto.timingSafeEqual` / sabit-zamanlı eşitlik)
- `|now - t| > 300` sn → **reddet** (replay koruması). `300` sabiti isimlendirilir.
- Geçersiz imza → **401**
- 🔴 **Gövdeyi parse edip yeniden stringify ederek doğrulama yapma.** Önce `request.text()`,
  doğrulama sonra parse. `request.json()` doğrulamadan önce çağrılmaz.
- Zarf `id` alanı ile **dedup** (`seen_events` tablosunda upsert) — retry'da çift işlem olmaz.
  Teslim **at-least-once**'tır ve sıra garantisi yoktur; exactly-once varsayan tasarım yazma.
- Handler = **imza → dedup → kuyruk/`waitUntil` → hemen 2xx**. Dış API çağrısı ve toplu yazma
  handler'ı bekletmez. Senkron uçların (webhook/action/hook) süre ve retry sınırları için
  `/docs/limits` — sayıyı ezberden yazma, dokümandan oku.
- **429** alındığında `Retry-After`'a uy; yoksa jitter'lı exponential backoff.

### 4.3 Session token (iframe)
- iframe: `const { data } = await bridgeCall('getSessionToken')` → `{ token, tokenType: 'Bearer', expiresIn: 120 }`
- İstemci: `Authorization: Bearer <token>`. TTL 120 sn → **istemcide cache'leme**, her çağrıda tazele.
- Sunucu: **HS256**, anahtar = tenant'ın `webhookSecret`'i. SDK `verifySessionToken` kullanılır.
- Claim'ler: `iss, aud, sub, role, tenantId, pluginId, iat, exp`
  - 🔴 **`aud === pluginId` kontrolü ZORUNLU** — başka eklentinin token'ı kabul edilmez.
  - `sub` = kullanıcı id · `role` = `manager` | `staff` → yetki bu claim'e göre.
  - `exp` **her istekte sunucuda** doğrulanır.
- 🔴 İstemciden gelen `tenantId` / `role` alanlarına **asla güvenilmez**; yalnız doğrulanmış
  claim'ler kullanılır. Repository çağrılarına giden `tenantId` **her zaman** imza/token kaynaklıdır.

### 4.4 iframe güvenliği
- Custom UI yanıtlarında **zorunlu** header:
  ```
  Content-Security-Policy: frame-ancestors https://app.restomenum.com https://test-restomenu.web.app
  ```
  Wildcard / `'none'` / eksik origin / header'ın hiç olmaması → **sürüm onayında reddedilir**.
  `next.config.ts` `headers()` içinde UI path'lerine eklenir. `X-Frame-Options: DENY` **konmaz**.
- `postMessage`'da `targetOrigin` **pinlenir** (`*` yasak); gelen mesajda `event.origin`
  allowlist'e karşı doğrulanır. Allowlist `config.ts`'te isimli sabit.
- `document.referrer` ile parent origin tespiti **yapılamaz** — iframe `referrerPolicy="no-referrer"`.
- Dış linkler App Bridge `openUrl` ile açılır.


### 4.5 SDK
```bash
npm install @restomenum/plugin-sdk    # Node 20+, sıfır runtime bağımlılığı (yalnız node:crypto)
```
`verifyWebhookSignature()` · `verifySessionToken()` · `exchangeCode()` · `RestomenumClient` (+`listAll()`)
· `actionResponse()` · hatalar `ApiError`/`OAuthError`/`SignatureError` · `EVENT_TYPES`/`SCOPES`/`PII_SCOPES`

**Kural:** imza doğrulama, token değişimi ve API çağrıları elle yeniden yazılmaz — SDK varsa SDK.
SDK `RestomenumAdapter` sınıfının **arkasında** kalır; `ApiError` servis katmanına sızmaz,
adapter kendi domain hatasına çevirir. workerd'de `node:crypto` için `nodejs_compat` flag'i gerekir.

**Referans uygulama** — bir uç/akış yazmadan önce buradaki karşılığına bak:
https://github.com/restomenum-com/plugin-sdk/tree/main/examples/sample-plugin
Connect, token değişimi, webhook doğrulama, action/hook ve iframe akışlarının çalışan halini içerir.
Örneği **kopyalama, deseni al** — bu dosyadaki katman/DI/adapter kuralları (§2.2) her durumda geçerli.

### 4.6 Go-live kontrol listesi
- [ ] webhook + hook + action imzaları ham gövdede, timing-safe, tolerans penceresiyle; geçersizde 401
- [ ] envelope `id` ile dedup çalışıyor; tekrar gelen olay çift işlem üretmiyor
- [ ] ağır işler handler dışına taşındı; senkron uçlar `/docs/limits` sınırlarının altında
- [ ] 429'da `Retry-After` + jitter'lı backoff var
- [ ] manifest'te yalnız kullanılan scope'lar, PII gerekçeli
- [ ] iframe için `frame-ancestors` CSP doğru origin'lerle mevcut
- [ ] hook `timeout` ve `failMode` bilinçli seçildi
- [ ] scope/event değişiklikleri release notes'ta
- [ ] publisher username belirlendi (**globally unique ve KALICI** — ilk gönderimden önce)
- [ ] kritik akışlar **gerçek tetikle** doğrulandı (§2.7) — simülasyonla değil
- [ ] **deploy sonrası smoke:** `/connect` akışı, webhook ucu 2xx dönüyor, iframe CSP header'ı
      geliyor, bir gerçek olay uçtan uca işleniyor

### 4.7 Portal yönetimi — Remote MCP (AI ile)

Portal işleri **OAuth 2.1 korumalı remote MCP sunucusu** üzerinden yürür: manifest düzenleme,
scope/izin, fiyat ve trial, sayfa/buton/hook tanımları, sürüm oluşturma ve incelemeye gönderme
sohbetle yapılır. Kurulum ya da şifre paylaşımı yok — Claude'a URL eklenir, kendi portal
hesabınla bağlanırsın:

```
https://restomenum-developer-portal.white-firefly-095a.workers.dev/mcp
```

- **Portal işlemleri elle değil MCP araçlarıyla yapılır** (`get_manifest`, `set_scopes`,
  `set_pricing`, `set_hooks`, `create_version`, `validate_version`, `submit_version` …) —
  panelde tıklama adımı tarif etme, aracı çağır.
- **Gönderimden önce `validate_version` çalıştırılır**; hata varsa `submit_version` denenmez.
- 🔴 **Scope, fiyat, manifest veya sürüm durumunu değiştiren çağrılar kullanıcı onayı olmadan
  yapılmaz.** Yeni scope tenant'ın **yeniden onayını** tetikler, fiyat değişikliği faturalandırmayı
  etkiler. Manifest'te yalnız gerçekten kullanılan scope'lar bulunur; PII scope'ları gerekçelenir.
- MCP'de yapılan manifest değişikliği repodaki karşılığıyla **senkron tutulur** ve ayrı commit'lenir.

---

## 5. Dizin düzeni

```
src/
  app/
    api/
      connect/route.ts        # OAuth callback (code → token exchange)
      webhook/route.ts        # imza → dedup → kuyruk → hemen 2xx
      action/route.ts         # panel butonu → actionResponse (senkron, hızlı)
      hook/route.ts           # flow-blocking hook (senkron, hızlı)
      session/**              # iframe'in çağırdığı, session token korumalı uçlar
    (ui)/                     # iframe Custom UI (React) — CSP header'lı
  models/                     # saf data model — DB import ETMEZ
  services/                   # iş kuralı — sınıf, DI ile bağımlılık
  repositories/               # SQL YALNIZ burada — toDto() ile açık dönüşüm
  adapters/
    RestomenumAdapter.ts      # platform
    <Provider>Adapter.ts      # eklentinin bağlandığı dış servis(ler)
  lib/
    bindings.ts               # Cloudflare binding erişimi (tek nokta)
    container.ts              # kompozisyon kökü (istek başına)
    crypto.ts                 # secret şifreleme + HMAC yardımcıları
    errors.ts                 # hata tipleri + tek merkezli yanıt üretimi
    utils/                    # yalnız saf, domain'siz fonksiyonlar
  db/
    schema.ts
    client.ts                 # drizzle (neon-http | d1) — §6
  config.ts                   # env okuma + zod ile açılış doğrulaması
drizzle/                      # migration'lar (commit edilir)
open-next.config.ts
wrangler.jsonc
```
Route handler'larda **`export const runtime = 'edge'` YAZILMAZ** — `@opennextjs/cloudflare`
Node runtime kullanır, edge segment'ini desteklemez; yazılırsa build kırılır.

---

## 6. Veritabanı

**Seçim projeye göredir — biri kurulur, ikisi birden değil.** Karar bir paragraflık ADR olarak
`docs/adr/` altına yazılır.

- **Neon Postgres** — ilişkisel sorgu derinliği, JSONB, büyüyen olay/mesaj geçmişi ya da analitik
  ihtiyacı varsa. `@neondatabase/serverless` **HTTP driver** + `drizzle-orm/neon-http`.
- **Cloudflare D1 (SQLite)** — veri hacmi küçük, ağırlıklı olarak tenant ayarı/şablon tutuluyorsa.
  Binding ile gelir (ayrı secret ve bağlantı yönetimi yok), daha ucuz; Postgres tipleri
  (JSONB, array, gelişmiş index) ve büyük veri için uygun değildir. `drizzle-orm/d1`.

**Hangisi seçilirse seçilsin geçerli:**
- 🔴 **TCP/socket driver (`pg`, `mysql2` …) workerd'de ÇALIŞMAZ**; bağlantı havuzu yoktur.
- 🔴 **İnteraktif transaction YOKTUR** (`db.transaction(async tx => ...)`) — her ikisinde de.
  Karşılığı: **idempotent upsert** (`onConflictDoUpdate`) veya **`db.batch([...])`**.
  Çok adımlı işi transaction varsayarak tasarlama; adımları idempotent kur.
- 🔴 Her sorgu **tenant ile scope'lanır** — `WHERE tenant_id = ?` olmayan sorgu review'da 🔴.
- 🔴 **Döngü içinde tek tek sorgu (N+1) YASAK** — `inArray()` ile toplu çek, bellekte eşle.
- Sık filtrelenen kolonlar (`tenant_id`, `event_id`, `created_at`) **index'li**; migration ile gelir.
- Şema değişikliği = `drizzle-kit generate` + migration dosyası commit'i. Elle DDL çalıştırılmaz.

---

## 7. Commit öncesi gözden geçirme (ZORUNLU)

Anlamlı bir değişiklikten sonra (yeni endpoint/akış/servis ya da mevcut mantığın değişmesi)
commit'ten **ÖNCE** [`standards-reviewer`](.claude/agents/standards-reviewer.md) subagent'ını
çalıştır — iki eksende (standart/mimari + maliyet/performans) read-only adversarial pass.

- 🔴 Critical → commit'ten **önce** çözülür · 🟡 Important → görev olarak kaydedilir, biriktirilmez.
- **Gerekmez:** yazım/yorum düzeltmesi, tek satır rename, ölü kod silme.
- Test/lint/typecheck kırmızıysa **"tamam" deme** — çıktıyı olduğu gibi paylaş.

---

## 8. Referanslar

- **Dev docs:** https://dev.restomenum.com/docs — sayfa markdown'ı `/docs/<slug>.md` ·
  tümü `/llms-full.txt` · OpenAPI `/openapi.json`
- **SDK:** https://github.com/restomenum-com/plugin-sdk
- **Örnek eklenti (referans uygulama):**
  https://github.com/restomenum-com/plugin-sdk/tree/main/examples/sample-plugin
- **Kritik sayfalar:** `/docs/iframe-security` · `/docs/session-token` · `/docs/webhook-signature` ·
  `/docs/gate-iframe` (App Bridge tel protokolü buradadır) · `/docs/limits` · `/docs/go-live` ·
  `/docs/monetization`
- **Diğer:** `/docs/quickstart` · `/docs/sdk` · `/docs/concepts` · `/docs/manifest` ·
  `/docs/lifecycle` · `/docs/events` · `/docs/api-reference` · `/docs/dev-stores` ·
  `/docs/versioning` · `/docs/changelog`

> Restomenum'un API / limit / güvenlik davranışı hakkında **ezberden cevap verme** —
> ilgili `/docs/<slug>.md` dosyasını oku.
