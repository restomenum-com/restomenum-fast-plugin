---
description: Bu şablondan yeni bir Restomenum eklentisi türetir — amaç, ad, veri katmanı ve portal kimliğini sorar, cevapları koda uygular.
---

# Kurulum röportajı

Bu depo bir **şablondur**. Görevin, kullanıcıya birkaç soru sorup şablonu onun eklentisine
dönüştürmek. Soruları sormadan hiçbir dosyayı değiştirme.

## 0. Ortamı hazırla

**Bağımlılıklar kurulu mu?** `node_modules` yoksa hiçbir şey çalışmaz — bu komut ilerleyen
adımlarda `npm run check` ve `drizzle-kit generate` çağırıyor.

```bash
node -v                    # 20+ olmalı (wrangler ve SDK bunu ister)
[ -d node_modules ] || npm ci
```

`npm ci` kullan, `npm install` DEĞİL: lockfile'daki sürümleri birebir kurar, şablonun
doğrulanmış yapılandırmasını korur. `npm ci` lockfile uyumsuzluğundan hata verirse
kullanıcıya söyle ve `npm install` öner — ama bunun lockfile'ı değiştireceğini belirt.

## 1. Önce durumu gör

`PROJECT.md` VARSA bu depo zaten yapılandırılmış demektir. Kullanıcıya mevcut yapılandırmayı
özetle ve **yeniden çalıştırmak isteyip istemediğini sor**; onay almadan üzerine yazma.

Ardından `git status` ile çalışma ağacına bak. Commit'lenmemiş değişiklik varsa kullanıcıyı
uyar — bu komut dosya siler ve yeniden adlandırır, geri dönülecek bir nokta olmalı.

## 2. Soruları sor

Sırayla ilerle. Serbest metin gerektirenleri doğrudan sor; seçenekli olanlarda
`AskUserQuestion` kullan.

### Önce: portal MCP bağlantısı

Portal işlerine geçmeden önce MCP bağlantısının kurulu olduğunu doğrula. Sunucu
`.mcp.json` içinde `restomenum-portal` adıyla tanımlıdır ve **OAuth 2.1 ile korunur** —
kullanıcı kendi portal hesabıyla yetkilendirir.

Bağlantıyı sınamak için `get_catalog` çağır (salt-okunur, önceden izinli):

- **Çalışıyorsa** → devam et.
- **Sunucu bağlı değilse / onay bekliyorsa** → Claude Code ilk kullanımda proje MCP
  sunucusu için onay ister; kullanıcıya bunu onaylamasını söyle.
- **Yetkilendirme gerekiyorsa** → OAuth akışı tarayıcıda açılır. Kullanıcıdan
  `/mcp` komutuyla `restomenum-portal` sunucusunu seçip **Authenticate** demesini iste.
  🔴 Kimlik doğrulama akışını SEN yürütme; kullanıcı kendi hesabıyla yetkilendirir.
  Tamamlandığında `get_catalog`'u tekrar dene.
- **Kullanıcı bağlanmak istemiyorsa** → portal adımlarını atla, röportajın geri kalanını
  tamamla ve `PROJECT.md`'ye "portal kaydı yapılmadı" diye yaz.

**a) Eklentinin amacı** (serbest metin)
> Bu eklenti ne yapacak? Bir-iki cümle yeterli.

Cevap; adı, önerilecek olayları ve veri katmanı kararını besler. `PROJECT.md`'ye yazılır.

**b) Ad ve slug** (serbest metin)
> Eklentinin görünen adı ne olsun? (ör. "Kurye Takip")

Slug'ı addan türet (küçük harf, tire), kullanıcıya doğrulat. Slug global benzersizdir.

**c) Veri katmanı** (`AskUserQuestion`)

| Seçenek | Ne zaman |
|---|---|
| **Cloudflare D1** | Veri küçük, ağırlıklı tenant ayarı/şablon. Binding ile gelir, ek hesap yok. |
| **Neon Postgres** | İlişkisel sorgu derinliği, JSONB, büyüyen olay/mesaj geçmişi, analitik. |
| **Durable Objects** | Tenant başına yüksek frekanslı sayaç/kilit, güçlü tutarlılık. |
| **Sen karar ver** | Amaç cevabına bakıp gerekçeli seç. |

🔴 **KV bu listede YOKTUR ve önerilmemelidir.** Tekilleştirme atomik sahiplenme ister
(`INSERT … ON CONFLICT` + etkilenen satır sayısı). KV'de koşullu yazma yoktur ve okuma nihai
tutarlıdır → iki eşzamanlı teslim de "ilk gören" olur ve olay **iki kez işlenir**. Kullanıcı
KV isterse bunu açıkla; KV yalnız nihai tutarlılığın sorun olmadığı yan rollerde (ayar
önbelleği) kullanılabilir, birincil depo olamaz.

"Sen karar ver" seçilirse ölçüt: olay/mesaj geçmişi birikiyor ya da ilişkisel sorgu gerekiyorsa
**Neon**; veri küçük ve ağırlıklı ayar ise **D1**; tenant başına sık güncellenen sayaç/kilit
varsa **Durable Objects**. Kararı gerekçesiyle söyle ve `PROJECT.md`'ye yaz.

**d) Abone olunacak olaylar** (`AskUserQuestion`, çoklu seçim)

Önce MCP `get_catalog` ile **canlı** listeyi al — ezberden olay adı yazma. Amaç cevabına göre
birkaçını öner. `status: "soon"` olanları seçilebilir göster ama **henüz canlı olmadığını** belirt.

**e) Panel içi arayüz gerekli mi?** (`AskUserQuestion`)
Gerekmiyorsa `/settings` sayfası, App Bridge ve `ui:page` scope'u kaldırılır — kullanılmayan
kod bırakılmaz (CLAUDE.md §2.3).

**f) Ücretlendirme** (`AskUserQuestion`): ücretsiz / abonelik.

**g) Portal kaydı** (`AskUserQuestion`)
> Eklentiyi portalda şimdi oluşturayım mı, yoksa mevcut bir kaydın var mı?

- **Oluştur** → `create_plugin` (ad, slug, açıklama, kategori) → `generate_client_secret`.
  🔴 `client_secret` YALNIZ BİR KEZ gösterilir; anında `.dev.vars`'a yaz ve kullanıcıyı uyar.
  Yenilemek saatte en çok 5 kez mümkündür.
- **Mevcut** → `list_plugins` ile göster, seçtir; `client_secret`'ı kullanıcıdan iste.
  Secret'ı **asla** koda, `PROJECT.md`'ye ya da log'a yazma.
- **Şimdi olmasın** → atla; `PROJECT.md`'ye "portal kaydı yapılmadı" yaz.

**h) Yayın adresi** (`AskUserQuestion`) — sürüm oluşturmak için ZORUNLU

`create_version` `webhook_url` ve `connect_url` ister; ikisi **https** ve **aynı domain**
olmalı. Adres bilinmeden sürüm oluşturulamaz, dolayısıyla manifest de yazılamaz.

- **Deploy adresim var** → kullanıcıdan al (ör. `https://<worker>.workers.dev`).
- **Yerel tünel kullanacağım** → `cloudflared tunnel --url http://localhost:8787` çıktısındaki
  adresi kullan. Geçicidir; tünel kapanınca manifest ölü adrese bakar, bunu söyle.
- **Henüz yok** → sürüm ve manifest adımlarını ATLA. Kullanıcıya deploy sonrası
  `/setup`'ı yeniden çalıştırabileceğini ya da manifest'i elle yazabileceğini söyle.
  `PROJECT.md`'ye "sürüm oluşturulmadı — yayın adresi bekleniyor" yaz.

## 3. Cevapları uygula

Tek geçişte, sırayla:

1. **`src/branding.ts`** — `PLUGIN_DISPLAY_NAME`, `PLUGIN_TAGLINE` güncellenir. Arayüz metinleri
   buradan okur; sayfalara elle ad yazma.
2. **`package.json` + `wrangler.jsonc` `name`** — İKİSİ BİRDEN slug'a çevrilir. Worker adı
   `workers.dev` alt alan adını belirler; tek tarafı değiştirmek sessizce yanlış Worker'a
   deploy ettirir.
3. **`wrangler.jsonc`** — `RESTOMENUM_PLUGIN_ID` vars'a yazılır (gizli değil). D1 seçildiyse
   `database_name` slug'a çevrilir; başka katman seçildiyse D1 binding'i kaldırılır.
4. **`.dev.vars`** — `.dev.vars.example`'dan kopyalanır; `RESTOMENUM_CLIENT_SECRET` doldurulur,
   `SECRET_ENCRYPTION_KEY` için `openssl rand -base64 32` çalıştırılır. Bu dosya `.gitignore`'da,
   asla commit edilmez.
5. **Veri katmanı** — seçilen kalır, diğerlerinin şema/repository/binding'i **silinir**
   (§2.3 ölü kod bırakılmaz). D1 dışı bir seçim için `src/db/schema.ts` ve
   `src/repositories/D1*Repository.ts` yeniden yazılır; `drizzle.config.ts` dialect'i güncellenir;
   `npx drizzle-kit generate` ile migration üretilir.
6. **Arayüz istenmediyse** — `src/app/settings/`, `src/lib/appBridge.ts`, `next.config.ts`
   içindeki CSP başlığı ve ilgili testler kaldırılır.
7. **`PROJECT.md`** oluşturulur (aşağıdaki şablon).
8. **Portal manifest'i** — yayın adresi varsa, BU SIRAYLA (her `set_*` aracı `version_id`
   ister, o yüzden sürüm önce gelir):

   1. `create_version` — semver (`1.0.0`), `webhook_url` = `<adres>/api/webhook`,
      `connect_url` = `<adres>/api/connect`
   2. `set_events` — (d) adımında seçilenler. Gerekli read-scope'lar ve `events:subscribe`
      **otomatik türetilir**, elle eklenmez.
   3. `set_scopes` — YALNIZ olaylardan/sayfalardan türemeyen ekstra izinler için
      (ör. `orders:write`, `customers:read`, `purchases:write`). Hiçbiri gerekmiyorsa ÇAĞIRMA;
      liste verirsen mevcut listenin yerine geçer. Hook scope'ları elle verilemez.
   4. `set_pages` — arayüz seçildiyse: `{ id: "settings", path: "/settings" }`.
      `ui:page` otomatik eklenir.
   5. `set_settings_page` — sayfayı "Kur/Ayarlar" ekranı olarak işaretler.
   6. `set_action_url` — `"/api/action"` (webhook origin'ine eklenir).
   7. `set_pricing` — (f) adımındaki seçim. ⚠️ Bu araç `plugin_id` alır, `version_id` DEĞİL.
      `free` seçilirse `confirm_cancel_subscriptions` gerekir; yeni eklentide abonelik
      olmadığı için güvenli, ama kullanıcıya söyle.
   8. `validate_version` — hiçbir şeyin sessizce düşmediğini teyit et. Kaydetme sırasında
      whitelist dışı öğeler SESSİZCE atılır; bu adım atlanamaz.
   9. `get_manifest` — sonucu kullanıcıya özetle.

   🔴 `submit_version` ÇAĞIRMA — kalıcı durum geçişidir, kullanıcı açıkça istemeden yapılmaz.
   Ayrıca manifest geçici bir tünel adresine bakıyorsa incelemeye gönderilmemelidir.

9. **Şablon bağlantısını çöz** — bu depo artık kullanıcının eklentisi, şablon değil.

   `origin` şablonun deposunu gösteriyor; bırakılırsa ilk `git push` kullanıcının
   eklentisini ŞABLONA göndermeye çalışır.

   ```bash
   git remote -v                                    # önce ne olduğunu gör
   git remote rename origin template 2>/dev/null    # varsa: şablon bağlantısını sakla
   ```

   `origin` yerine `template` yapılır, silinmez — böylece kullanıcı ileride şablon
   güncellemelerini çekebilir (`git fetch template`). `origin` adı kendi deposu için boşalır.
   Uzak bağlantı zaten yoksa (zip indirilmişse) bu adımı sessizce atla.

   Kullanıcıya söyle:
   ```
   Kendi deponu oluşturduktan sonra:
     git remote add origin <senin-repo-url>
     git push -u origin main
   ```

   🔴 Deponun kendisini SİLME, geçmişi SIFIRLAMA. Şablon geçmişi kullanıcının kendi
   commit'lerinin altında kalır ve zararsızdır; silmek geri alınamaz bir işlemdir.

## 4. Doğrula ve raporla

`npm run check` çalıştır. Kırmızıysa **düzelt**, "tamam" deme.

Sonra kullanıcıya şunları söyle:
- Ne değiştirildi (dosya listesi)
- Sıradaki adımlar: veritabanını oluştur (`wrangler d1 create …` gibi), migration uygula,
  `npm run dev`, deploy için Workers Builds'i bağla
- **Henüz gerçek tetikle denenmemiş olanlar** — dürüstçe (CLAUDE.md §2.7)

Son olarak değişiklikleri commit et (§3 pathspec kuralı) — ama **push etme**: `origin`
artık tanımlı değil ve hedef depo kullanıcının kararı.

## `PROJECT.md` şablonu

```markdown
# <Eklenti Adı>

<amaç — kullanıcının cümlesi>

## Kapsam
- Abone olunan olaylar: …
- Panel arayüzü: var / yok
- Ücretlendirme: …

## Veri katmanı kararı (ADR)
**Seçim:** <D1 | Neon | Durable Objects>
**Gerekçe:** <neden — CLAUDE.md §6 bunu ister>
**Alternatifler:** <neden elenmediler>

## Portal
- pluginId: <uuid>   (client_secret .dev.vars'ta, repoda DEĞİL)
- slug: <slug>
```

## Kurallar

- **Sormadan değiştirme.** Röportaj bitmeden dosyaya dokunma.
- **Ezberden değer yazma.** Olay adları, scope'lar ve panel origin'leri için `get_catalog`;
  API davranışı için `/docs/<slug>.md`.
- **Secret'ı yalnız `.dev.vars`'a yaz.** Koda, `PROJECT.md`'ye, log'a ya da commit'e asla.
- Şablonun kendi kuralları (CLAUDE.md) bu komut sırasında da geçerlidir.
