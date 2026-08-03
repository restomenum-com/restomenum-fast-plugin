/**
 * Eklentinin kullanıcıya görünen kimliği.
 *
 * 🔴 TEK DEĞİŞTİRME NOKTASI. Arayüz metinleri eklenti adını buradan alır; sayfalara
 * elle yazılmaz. `/setup` kurulum röportajı bu dosyayı eklentinin gerçek adıyla günceller.
 *
 * Bağımlılığı yoktur — istemci bileşenlerinden de güvenle import edilir
 * (config.ts zod ve binding'leri çeker, istemciye taşınmamalıdır).
 */

/** Panelde ve kurulum ekranlarında görünen ad. */
export const PLUGIN_DISPLAY_NAME = 'Restomenum Eklentisi'

/** Kurulum sonrası ekranında gösterilen tek cümlelik özet. */
export const PLUGIN_TAGLINE = 'Eklenti işletmenize başarıyla bağlandı.'

/** Panelde eklentiye ulaşılan yol — kullanıcıya yön göstermek için. */
export const PANEL_PATH_HINT = 'Eklentiler'
