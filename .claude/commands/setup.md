---
description: Bu şablondan yeni bir Restomenum eklentisi türetir — amaç, ad, veri katmanı ve portal kimliğini sorar, cevapları koda uygular.
---

# Kurulum röportajı

Bu depo bir **şablondur**. Görevin, kullanıcıya birkaç soru sorup şablonu onun eklentisine
dönüştürmek. Soruları sormadan hiçbir dosyayı değiştirme.

## 0. Önce durumu gör

`PROJECT.md` VARSA bu depo zaten yapılandırılmış demektir. Kullanıcıya mevcut yapılandırmayı
özetle ve **yeniden çalıştırmak isteyip istemediğini sor**; onay almadan üzerine yazma.

Ardından `git status` ile çalışma ağacına bak. Commit'lenmemiş değişiklik varsa kullanıcıyı
uyar — bu komut dosya siler ve yeniden adlandırır, geri dönülecek bir nokta olmalı.

## 1. Soruları sor

Sırayla ilerle. Serbest metin gerektirenleri doğrudan sor; seçenekli olanlarda
`AskUserQuestion` kullan.

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

- **Oluştur** → MCP `create_plugin` + `generate_client_secret`.
  🔴 `client_secret` YALNIZ BİR KEZ gösterilir; anında `.dev.vars`'a yaz ve kullanıcıyı uyar.
- **Mevcut** → `pluginId` ve `client_secret`'ı kullanıcıdan iste. Bunları **asla** koda,
  `wrangler.jsonc` dışına ya da log'a yazma.

## 2. Cevapları uygula

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
8. **Portal manifest'i** — kullanıcı istiyorsa MCP ile: `set_events`, `set_pages`,
   `set_action_url`, `set_pricing`, ardından `validate_version`.
   🔴 `submit_version` ÇAĞIRMA — kalıcı durum geçişidir, kullanıcı açıkça istemeden yapılmaz.
   Webhook/connect URL'leri gerçek deploy adresi belli olmadan yazılamaz; bunu söyle.

## 3. Doğrula ve raporla

`npm run check` çalıştır. Kırmızıysa **düzelt**, "tamam" deme.

Sonra kullanıcıya şunları söyle:
- Ne değiştirildi (dosya listesi)
- Sıradaki adımlar: veritabanını oluştur (`wrangler d1 create …` gibi), migration uygula,
  `npm run dev`, deploy için Workers Builds'i bağla
- **Henüz gerçek tetikle denenmemiş olanlar** — dürüstçe (CLAUDE.md §2.7)

Son olarak değişiklikleri commit et (§3 pathspec kuralı) — ama **push etme**, o ayrı onay ister.

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
