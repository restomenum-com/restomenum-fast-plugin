#!/usr/bin/env node
/**
 * PostToolUse hook — GENERIC standards check.
 *
 * Bir kaynak dosya Edit/Write/MultiEdit ile değiştiğinde, stack'ten bağımsız
 * mühendislik standartlarını denetler ve ihlalleri Claude'a uyarı
 * (additionalContext) olarak bildirir. Belirli bir framework/vendor'a bağlı DEĞİLDİR.
 *
 * Denetlenenler:
 *   [C0] Sözdizimi (node --check) — yalnız düz JS; TS'te typecheck'e bırakılır
 *   [C1] Sabit kodlanmış secret / anahtar / özel anahtar / JWT
 *   [C2] eval() / new Function() — kod enjeksiyon yüzeyi
 *   [C3] Secret/imza karşılaştırmasında ===/!== (timing attack)
 *   [C4] Kriptografik amaçla Math.random()
 *   [C5] Mass-assignment: doğrulanmamış istek gövdesinin object-literal'e spread'i
 *   [C6] Yutulan hata: boş catch bloğu
 *   [C7] Hassas veri log'a yazılıyor
 *   [C8] TypeScript'te `any`
 *   [C9] Döngü içinde await'li sorgu/çağrı (N+1)
 *  [C10] Timeout'suz fetch
 *  [C11] Dosya uzunluğu (> maxFileLines)
 *  [C12] Bırakılmış debugger
 *  [C13] Env'in merkezî config dışında okunması (proje'de config dosyası varsa)
 *
 * Yapılandırma (opsiyonel): <projeKökü>/.claude/standards-check.config.json
 *   {
 *     "maxFileLines": 300,
 *     "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
 *     "ignore": ["node_modules/", "dist/"],
 *     "lengthExempt": ["\\.d\\.ts$", "/migrations/"],
 *     "untrustedSources": ["req.body", "request.body"],
 *     "configFiles": ["src/config.ts"],
 *     "disable": ["C10", "C13"]
 *   }
 *
 * Hook hatası düzenlemeyi ASLA engellemez (her durumda exit 0).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ─────────────────────────────────────────────────────────── varsayılan ayarlar

const DEFAULTS = {
  maxFileLines: 300,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  ignore: [
    'node_modules/', 'dist/', 'build/', 'out/', 'coverage/',
    '.next/', '.open-next/', '.wrangler/', '.vercel/', '.turbo/',
    '.git/', 'vendor/', '__snapshots__/',
  ],
  // Uzunluk kuralından muaf: üretilmiş / doğası gereği uzun dosyalar
  lengthExempt: [
    '\\.d\\.ts$', '\\.generated\\.', '\\.gen\\.', '\\bschema\\.[jt]s$',
    '/migrations?/', '/drizzle/', '\\.min\\.[jt]s$', '/locales?/',
  ],
  // Doğrulanmamış dış girdi kabul edilen ifadeler (mass-assignment kaynağı)
  untrustedSources: [
    'req.body', 'request.body', 'ctx.body', 'ctx.request.body',
    'data.data', 'data.body', 'event.body', 'body', 'payload', 'rawBody',
  ],
  // Env okumasının serbest olduğu merkezî config dosyaları
  configFiles: [
    'config.ts', 'config.js', 'src/config.ts', 'src/config.js',
    'src/lib/config.ts', 'src/lib/config.js', 'src/env.ts', 'env.ts',
    'app/config.ts', 'lib/config.ts',
  ],
  disable: [],
};

// Bilinen secret önekleri — eşleşme tek başına yüksek güvenilirlikli bulgudur
const TOKEN_PATTERNS = [
  [/\bsk_live_[A-Za-z0-9]{8,}/g, 'Stripe canlı secret key'],
  [/\bsk_test_[A-Za-z0-9]{8,}/g, 'Stripe test secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'GitHub fine-grained token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/\bAIza[0-9A-Za-z_\-]{30,}/g, 'Google API key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, 'özel anahtar (PEM)'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\./g, 'JWT'],
  [/\bpostgres(?:ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/g, 'Postgres connection string (şifreli)'],
  [/\bmongodb(?:\+srv)?:\/\/[^\s'"`]*:[^\s'"`@]+@/g, 'MongoDB connection string (şifreli)'],
];

const SECRET_NAME =
  'secret|token|password|passwd|pwd|api[_-]?key|apikey|client[_-]?secret|' +
  'private[_-]?key|access[_-]?key|auth[_-]?token|credential|webhook[_-]?secret';

const PLACEHOLDER =
  /^(?:x{3,}|\.{3,}|-+|<.*>|\{\{.*\}\}|)$|your|example|placeholder|changeme|change-me|dummy|sample|todo|fake|redacted|process\.env|import\.meta|null|undefined|test[_-]?only/i;

// ──────────────────────────────────────────────────────────────── yardımcılar

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
  });
}

function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function loadConfig(root) {
  const cfg = { ...DEFAULTS };
  try {
    const p = path.join(root, '.claude', 'standards-check.config.json');
    if (fs.existsSync(p)) Object.assign(cfg, JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (_) { /* bozuk config sessizce yok sayılır */ }
  return cfg;
}

/** Yorum ve string literal'leri boşlukla değiştirir — regex taramalarında yanlış pozitifi düşürür. */
function stripCommentsAndStrings(src, { keepStrings = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += keepStrings ? c : ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += keepStrings ? src.slice(i, i + 2) : '  '; i += 2; continue; }
        if (src[i] === quote) { out += keepStrings ? quote : ' '; i++; break; }
        out += keepStrings ? src[i] : (src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function isCommentLine(src, index) {
  const start = src.lastIndexOf('\n', index) + 1;
  return /^\s*(?:\/\/|\*|\/\*)/.test(src.slice(start, index + 1));
}

function uniqLines(arr, max = 8) {
  const seen = [...new Set(arr)].sort((a, b) => a - b);
  return seen.length > max ? `${seen.slice(0, max).join(', ')} … (+${seen.length - max})` : seen.join(', ');
}

function matchesAny(str, patterns) {
  return patterns.some((p) => {
    try { return new RegExp(p).test(str); } catch (_) { return str.includes(p); }
  });
}

/** Verilen indeksten sonraki bloğun ({...}) kapanış indeksini döndürür. */
function blockEnd(src, openBraceIdx) {
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ──────────────────────────────────────────────────────────────── denetimler

function runChecks({ filePath, rel, code, cfg, root }) {
  const findings = [];
  const add = (id, sev, msg) => { if (!cfg.disable.includes(id)) findings.push({ id, sev, msg }); };

  const ext = path.extname(filePath).toLowerCase();
  const isTs = ext === '.ts' || ext === '.tsx';
  const lines = code.split('\n');
  // Yorum + string'siz kod: yapısal taramalar için (mass-assignment, eval, döngü…)
  const bare = stripCommentsAndStrings(code);
  // Yorumsuz ama string'li kod: secret taraması için (değer string içinde yaşar)
  const noComments = stripCommentsAndStrings(code, { keepStrings: true });

  // ── [C0] Sözdizimi — yalnız düz JS. TS `node --check` ile parse edilemez.
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    try {
      execFileSync(process.execPath, ['--check', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      const detail = (err && err.stderr ? err.stderr.toString() : '')
        .split('\n').filter((l) => l.trim()).slice(0, 4).join(' | ');
      add('C0', 'critical',
        `SÖZDİZİMİ HATASI (node --check başarısız). Commit'ten önce MUTLAKA düzelt:\n    ${detail || '(ayrıntı alınamadı)'}`);
    }
  }

  // ── [C1] Sabit kodlanmış secret
  {
    const hits = [];
    for (const [re, label] of TOKEN_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(noComments))) hits.push(`${label} (satır ${lineOf(noComments, m.index)})`);
    }
    // `apiKey = "..."` biçimli atamalar.
    // Test dosyalarında bu sezgi kapalıdır: fixture secret'ları gerçek değildir ve
    // baskın yanlış-pozitif kaynağıdır. Önek-tabanlı gerçek token tespiti (yukarıda) açık kalır.
    const isTestFile =
      /\.(?:test|spec)\.[jt]sx?$/.test(rel) ||
      /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|testing|fixtures|mocks)\//.test(rel)
    const assignRe = new RegExp(
      `\\b([\\w$.]*(?:${SECRET_NAME})[\\w$]*)\\s*[:=]\\s*(['"\`])([^'"\`\\n]{12,})\\2`, 'gi');
    let a;
    while (!isTestFile && (a = assignRe.exec(noComments))) {
      const value = a[3];
      if (PLACEHOLDER.test(value)) continue;
      if (/^[A-Z0-9_]+$/.test(value) && value.length < 20) continue; // sabit isim gibi görünüyor
      hits.push(`\`${a[1]}\` literal string'e atanmış (satır ${lineOf(noComments, a.index)})`);
    }
    if (hits.length) {
      add('C1', 'critical',
        `Sabit kodlanmış secret şüphesi: ${[...new Set(hits)].slice(0, 6).join(' · ')}. ` +
        `Secret'lar koda/repoya YAZILMAZ — env/secret manager'dan okunur. ` +
        `Bu değer gerçek bir secret ise dosyadan çıkar, .gitignore'ı doğrula ve anahtarı ROTE ET.`);
    }
  }

  // ── [C2] eval / new Function
  {
    const ev = (bare.match(/\beval\s*\(/g) || []).length;
    const nf = (bare.match(/\bnew\s+Function\s*\(/g) || []).length;
    if (ev || nf) {
      const parts = [];
      if (ev) parts.push(`${ev} eval()`);
      if (nf) parts.push(`${nf} new Function()`);
      add('C2', 'critical',
        `${parts.join(' ve ')} var (kod enjeksiyon yüzeyi). Girdiyle üretilen kod asla çalıştırılmaz — ` +
        `güvenli bir alternatifle değiştir (lookup tablosu, parser, açık switch).`);
    }
  }

  // ── [C3] Secret/imza karşılaştırmasında ===/!==
  {
    const re = new RegExp(
      `\\b([\\w$.]*(?:${SECRET_NAME}|signature|hmac|digest|checksum)[\\w$]*)\\s*(===|!==|==|!=)\\s*([A-Za-z_$][\\w$.]*)`, 'gi');
    const revRe = new RegExp(
      `\\b([A-Za-z_$][\\w$.]*)\\s*(===|!==|==|!=)\\s*([A-Za-z_$][\\w$.]*(?:${SECRET_NAME}|signature|hmac|digest|checksum)[\\w$]*)\\b`, 'gi');
    const hitLines = [];
    for (const rx of [re, revRe]) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(bare))) {
        const ln = lineOf(bare, m.index);
        const lineText = lines[ln - 1] || '';
        if (/timingSafeEqual|timing_safe|compare_digest|constantTimeEqual|safeCompare/i.test(lineText)) continue;
        if (/\b(?:undefined|null|true|false)\b/.test(m[3] || m[1])) continue;
        if (/\.length\b|typeof\b/.test(lineText)) continue;
        hitLines.push(ln);
      }
    }
    if (hitLines.length) {
      add('C3', 'critical',
        `Secret/imza karşılaştırması ===/!== ile yapılıyor (satır ${uniqLines(hitLines)}). ` +
        `Bu timing attack'e açıktır — sabit zamanlı karşılaştırma kullan ` +
        `(\`crypto.timingSafeEqual\`, \`hmac.compare_digest\`, \`hash_equals\`). ` +
        `Uzunluk farkı da sızdırır: önce uzunluğu eşitle ya da sabit uzunluklu digest karşılaştır.`);
    }
  }

  // ── [C4] Kriptografik amaçla Math.random()
  {
    const re = /Math\.random\s*\(\s*\)/g;
    const hitLines = [];
    let m;
    while ((m = re.exec(bare))) {
      const ln = lineOf(bare, m.index);
      const ctx = lines.slice(Math.max(0, ln - 4), ln + 1).join(' ');
      if (/token|secret|nonce|salt|password|otp|apikey|api[_-]?key|session|csrf|uuid|verif|reset|invite/i.test(ctx)) {
        hitLines.push(ln);
      }
    }
    if (hitLines.length) {
      add('C4', 'critical',
        `Kriptografik görünen bir bağlamda Math.random() (satır ${uniqLines(hitLines)}). ` +
        `Math.random() tahmin edilebilirdir — \`crypto.randomUUID()\` / \`crypto.getRandomValues()\` kullan.`);
    }
  }

  // ── [C5] Mass-assignment: doğrulanmamış girdinin object-literal'e spread'i
  {
    const srcAlt = cfg.untrustedSources
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const spreadRe = new RegExp(`\\.\\.\\.\\s*(${srcAlt})\\b`, 'g');
    const hits = [];
    let sm;
    while ((sm = spreadRe.exec(bare))) {
      const at = sm.index;
      // "..." ifadesini saran en yakın kapatılmamış açılışı bul:
      // '{' → object-literal spread (mass-assignment) · '[' veya '(' → kapsam dışı
      let dCurly = 0, dSquare = 0, dParen = 0, enclosing = 0;
      for (let i = at - 1; i >= 0; i--) {
        const ch = bare[i];
        if (ch === '}') dCurly++;
        else if (ch === ']') dSquare++;
        else if (ch === ')') dParen++;
        else if (ch === '{') { if (dCurly === 0) { enclosing = i + 1; break; } dCurly--; }
        else if (ch === '[') { if (dSquare === 0) { enclosing = -1; break; } dSquare--; }
        else if (ch === '(') { if (dParen === 0) { enclosing = -1; break; } dParen--; }
      }
      if (enclosing <= 0) continue;
      const braceIdx = enclosing - 1;
      const pre = bare.slice(Math.max(0, braceIdx - 200), braceIdx);
      const lastSeg = pre.split(/[;\n]/).pop() || '';
      // logger/console çağrısının içindeki spread mass-assignment değildir
      if (/(?:logger|console|log)\s*\.\s*\w+\s*\([^)]*$/.test(lastSeg)) continue;
      const isWrite = /\.(?:set|update|add|create|insert|upsert|values|save|put)\s*\(\s*$/.test(pre);
      hits.push({ ln: lineOf(bare, at), field: sm[1], isWrite });
    }
    if (hits.length) {
      const writes = hits.filter((h) => h.isWrite).length;
      const fields = [...new Set(hits.map((h) => h.field))].join(', ');
      add('C5', 'critical',
        `Mass-assignment: ${hits.length} yerde doğrulanmamış dış girdi (${fields}) doğrudan bir ` +
        `object-literal'e spread'leniyor` +
        (writes ? ` — ${writes} tanesi bir yazma çağrısının (set/update/insert/upsert/values) içinde` : '') +
        `. Satır: ${uniqLines(hits.map((h) => h.ln))}. ` +
        `İstemci keyfi alan enjekte edebilir (rol, sahiplik, fiyat, tenant). ` +
        `İzinli alanları alan-alan whitelist'le ya da şema doğrulamasının (zod vb.) ÇIKTISINI kullan. ` +
        `Array-spread ve logging kapsam dışıdır.`);
    }
  }

  // ── [C6] Yutulan hata: boş catch
  {
    const re = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
    const hitLines = [];
    let m;
    while ((m = re.exec(bare))) hitLines.push(lineOf(bare, m.index));
    if (hitLines.length) {
      add('C6', 'important',
        `${hitLines.length} boş catch bloğu (satır ${uniqLines(hitLines)}) — hata sessizce yutuluyor. ` +
        `En az log'la, ya da yeniden fırlat. Bilinçli yutma ise nedenini yorumda yaz.`);
    }
  }

  // ── [C7] Hassas veri log'a yazılıyor
  {
    const re = new RegExp(
      `(?:console|logger|log)\\s*\\.\\s*\\w+\\s*\\([^)]{0,200}?\\b([\\w$.]*(?:${SECRET_NAME}|authorization|cookie|session|creditcard|card[_-]?number|ssn|phone|email)[\\w$]*)`,
      'gi');
    const hits = [];
    let m;
    while ((m = re.exec(bare))) hits.push({ ln: lineOf(bare, m.index), what: m[1] });
    if (hits.length) {
      add('C7', 'important',
        `Hassas görünen değer log'lanıyor: ${[...new Set(hits.map((h) => h.what))].slice(0, 5).join(', ')} ` +
        `(satır ${uniqLines(hits.map((h) => h.ln))}). Secret ve PII log'a YAZILMAZ — ` +
        `çıkar ya da maskele (son 4 hane / hash / sabit yer tutucu).`);
    }
  }

  // ── [C8] TypeScript'te any
  if (isTs) {
    const re = /(?::\s*any\b|<\s*any\s*>|\bas\s+any\b|\bany\s*\[\s*\]|Array\s*<\s*any\s*>|Record\s*<[^>]*\bany\b)/g;
    const hitLines = [];
    let m;
    while ((m = re.exec(bare))) hitLines.push(lineOf(bare, m.index));
    if (hitLines.length) {
      add('C8', 'important',
        `${hitLines.length} yerde \`any\` (satır ${uniqLines(hitLines)}). ` +
        `Kaçış tipi tip güvenliğini iptal eder — bilinmeyen için \`unknown\` + daraltma, ` +
        `dış girdi için şema doğrulamasından türeyen tip kullan.`);
    }
  }

  // ── [C9] Döngü içinde await'li sorgu/çağrı (N+1)
  {
    const loopRe = /\b(?:for\s+await\s*\(|for\s*\(|while\s*\()/g;
    const hitLines = [];
    let m;
    while ((m = loopRe.exec(bare))) {
      const open = bare.indexOf('{', m.index);
      if (open === -1 || open - m.index > 300) continue;
      const end = blockEnd(bare, open);
      if (end === -1) continue;
      const body = bare.slice(open, end);
      if (!/\bawait\b/.test(body)) continue;
      if (/\b(?:fetch|query|execute|select|insert|update|delete|findOne|findMany|findFirst|get|getAll|send|request|invoke)\s*\(/.test(body)) {
        // Promise.all/allSettled ile toplanmışsa sıralı değildir
        if (/Promise\s*\.\s*(?:all|allSettled)\s*\(/.test(body)) continue;
        hitLines.push(lineOf(bare, m.index));
      }
    }
    if (hitLines.length) {
      add('C9', 'important',
        `Döngü içinde await'li sorgu/çağrı — olası N+1 (satır ${uniqLines(hitLines)}). ` +
        `Toplu çekim (IN / batch endpoint) ya da \`Promise.all\` ile düzleştirilebilir mi bak. ` +
        `Sıralılık bilinçliyse (rate limit, sıra bağımlılığı) nedenini yorumda yaz.`);
    }
  }

  // ── [C10] Timeout'suz fetch
  {
    const fetchCount = (bare.match(/\bfetch\s*\(/g) || []).length;
    const hasTimeout = /AbortSignal|AbortController|signal\s*:|timeout\s*:/i.test(bare);
    if (fetchCount > 0 && !hasTimeout) {
      add('C10', 'important',
        `${fetchCount} fetch çağrısı var ama dosyada hiç timeout/abort yok. ` +
        `Timeout'suz dış çağrı asılı kalıp isteği ve kaynak bütçesini tüketir — ` +
        `\`AbortSignal.timeout(ms)\` (veya AbortController) ekle ve hata yolunu ele al.`);
    }
  }

  // ── [C11] Dosya uzunluğu
  {
    const exempt = matchesAny(rel, cfg.lengthExempt);
    if (!exempt && lines.length > cfg.maxFileLines) {
      add('C11', 'important',
        `Dosya ${lines.length} satır (> ${cfg.maxFileLines}). Bir dosya tek iş yapmalı; ` +
        `iş büyüdüyse parçala ve anlamlı bir klasör altında topla ` +
        `(data model / data access / iş kuralı / saf yardımcı ayrı dosyalara).`);
    }
  }

  // ── [C12] Bırakılmış debugger
  {
    const n = (bare.match(/(?:^|[\s;{])debugger\b/g) || []).length;
    if (n > 0) add('C12', 'important', `${n} \`debugger\` bırakılmış — commit'lenen kodda kalmamalı, kaldır.`);
  }

  // ── [C13] Env merkezî config dışında okunuyor
  {
    const isConfigFile = cfg.configFiles.some((c) => rel === c || rel.endsWith('/' + c));
    const configExists = cfg.configFiles.some((c) => fs.existsSync(path.join(root, c)));
    if (!isConfigFile && configExists) {
      const re = /\b(?:process\.env|import\.meta\.env)\s*[.[]\s*['"]?([A-Za-z_][\w]*)/g;
      const hits = [];
      let m;
      while ((m = re.exec(bare))) {
        if (/^NODE_ENV$/.test(m[1])) continue;
        hits.push({ ln: lineOf(bare, m.index), name: m[1] });
      }
      if (hits.length) {
        add('C13', 'important',
          `Env doğrudan okunuyor (${[...new Set(hits.map((h) => h.name))].slice(0, 5).join(', ')}; ` +
          `satır ${uniqLines(hits.map((h) => h.ln))}) ama projede merkezî config dosyası var. ` +
          `Env tek yerde okunup açılışta doğrulanmalı — eksik değişken sessiz bozulma değil, açık hata üretmeli.`);
      }
    }
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────── main

(async () => {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw || '{}');

    const filePath =
      (payload.tool_input && payload.tool_input.file_path) ||
      (payload.tool_response && payload.tool_response.filePath) ||
      '';
    if (!filePath) return process.exit(0);

    const normalized = filePath.split(path.sep).join('/');
    const root = findProjectRoot(path.dirname(filePath));
    const cfg = loadConfig(root);

    if (!cfg.extensions.includes(path.extname(normalized).toLowerCase())) return process.exit(0);
    if (cfg.ignore.some((seg) => normalized.includes(seg))) return process.exit(0);
    if (!fs.existsSync(filePath)) return process.exit(0);

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1_500_000) return process.exit(0); // devasa/üretilmiş dosya

    const code = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(root, filePath).split(path.sep).join('/');

    const findings = runChecks({ filePath, rel, code, cfg, root });
    if (!findings.length) return process.exit(0);

    findings.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'critical' ? -1 : 1));
    const rendered = findings
      .map((f) => `- ${f.sev === 'critical' ? '🔴' : '🟡'} [${f.id}] ${f.msg}`)
      .join('\n');

    const context =
      `[standards-check] ${rel} için ${findings.length} bulgu:\n${rendered}\n\n` +
      `Değerlendirme kuralı: bu turda YENİ yazdığın kod ihlale sebep olduysa HEMEN düzelt. ` +
      `İhlal dosyada önceden var olan (legacy) koddan geliyorsa kodu kendiliğinden bozma — ` +
      `işin sonunda kullanıcıya kısaca raporla. ` +
      `🔴 bulgular commit'ten ÖNCE çözülür; sözdizimi hatası her durumda düzeltilir. ` +
      `Yanlış pozitif olduğunu düşünüyorsan gerekçesini söyle, sessizce yok sayma ` +
      `(kalıcı muafiyet: .claude/standards-check.config.json → "disable": ["C10"]).`;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
      suppressOutput: true,
    }));
    process.exit(0);
  } catch (_) {
    process.exit(0); // hook hatası düzenlemeyi asla engellemez
  }
})();
