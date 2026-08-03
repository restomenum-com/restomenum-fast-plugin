/**
 * Panel origin'leri — CSP `frame-ancestors` için.
 *
 * SDK'nın `PANEL_ORIGINS` sabiti burada TEKRARLANIR, çünkü `next.config.ts` CJS bağlamında
 * yüklenir ve SDK yalnız ESM export'u sunar (import edilemez).
 * Kayma riski `src/__tests__/panelOrigins.test.ts` ile testle kapatılmıştır — liste SDK'dan
 * saparsa test kırılır.
 */
export const PANEL_ORIGINS_FOR_CSP = [
  'https://app.restomenum.com',
  'https://test-restomenu.web.app',
] as const
