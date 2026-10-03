#!/usr/bin/env node
/* gen-audio — generuje nagrania lektora (ElevenLabs) dla angielskich słówek i zdań z aplikacji Wordbox.
 *
 *   node tools/gen-audio.cjs --dry      pokazuje, ile tekstów i znaków do nagrania (nic nie wysyła)
 *   node tools/gen-audio.cjs            generuje brakujące nagrania do audio/*.mp3 i odświeża audio/manifest.json
 *
 * Klucz API NIE jest częścią aplikacji ani repozytorium. Skrypt czyta go ze zmiennej środowiskowej
 * ELEVENLABS_API_KEY albo z pliku tools/.env (ignorowanego przez Git):
 *     ELEVENLABS_API_KEY=...
 *     ELEVENLABS_VOICE_ID=...        (wymagane przy generowaniu)
 *     ELEVENLABS_MODEL=eleven_flash_v2_5   (opcjonalnie; domyślnie tani, szybki model)
 * Skrypt jest idempotentny: istniejących plików nie nagrywa ponownie, więc po dopisaniu słówek
 * wystarczy uruchomić go jeszcze raz — zapłacisz tylko za nowe teksty.
 */
'use strict';
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = n => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : undefined; };
const ROOT = path.resolve(opt('root') || path.join(__dirname, '..'));

/* ---- ta sama funkcja skrótu co w aplikacji (sprawdza ją test audiotest) ---- */
function auNorm(t) { return String(t).replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function auHash(t) {
  const s = auNorm(t); let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 0x01000193) >>> 0; b ^= c + i; b = Math.imul(b, 0x85ebca6b) >>> 0; }
  return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
}

/* ---- .env (opcjonalny, lokalny) ---- */
function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

/* ---- teksty do nagrania: czytane z index.html ---- */
function collectTexts(html) {
  const clean = s => String(s).replace(/[\[\]]/g, '').trim();
  const arr = name => { const st = 'var ' + name + '=[', a = html.indexOf(st); if (a < 0) return []; const b = html.indexOf('];', a); return new Function('return [' + html.slice(a + st.length, b) + ']')(); };
  const out = new Map(); // klucz -> tekst do nagrania (zachowujemy oryginalną pisownię pierwszego wystąpienia)
  const add = t => { t = clean(t); if (!t || !/[a-z]/i.test(t)) return; const k = auNorm(t); if (!out.has(k)) out.set(k, t); };
  arr('CUR_RAW').forEach(l => add(String(l).split('|')[1] || ''));
  arr('SENT_RAW').forEach(l => add(String(l).split('|')[1] || ''));
  const bi = html.indexOf('var BONUS='); if (bi > -1) { try { const e = html.indexOf(';\n', bi); const j = JSON.parse(html.slice(bi + 10, e)); (Array.isArray(j) ? j : Object.values(j)).forEach(b => b && b.en && add(b.en)); } catch (e) { /* brak dodatkowych słówek */ } }
  (html.match(/lang:'en',en:'[^']*'/g) || []).forEach(m => m.replace(/.*en:'/, '').replace(/'$/, '').split(',').forEach(w => add(w)));
  (html.match(/lang:'en',list:'[^']*'/g) || []).forEach(m => m.replace(/.*list:'/, '').replace(/'$/, '').split(',').forEach(w => add(w.split('|')[0])));
  return out;
}

const BACKOFF = +process.env.ELEVENLABS_BACKOFF_MS || 2000; // przerwa przed ponowieniem (ms)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function synth(text, cfg) {
  const url = cfg.base + '/v1/text-to-speech/' + encodeURIComponent(cfg.voice) + '?output_format=' + encodeURIComponent(cfg.format);
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: cfg.model }) }); }
    catch (e) { if (attempt === 5) throw Object.assign(new Error('Brak połączenia z ElevenLabs: ' + e.message), { fatal: true }); await sleep(BACKOFF * (attempt + 1)); continue; }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    let body = ''; try { body = await res.text(); } catch (e) { /* pusta */ }
    if (res.status === 401 || res.status === 403) {
      const quota = /quota|exceed|limit/i.test(body);
      throw Object.assign(new Error(quota ? 'Wyczerpany limit znaków w koncie ElevenLabs.' : 'ElevenLabs odrzucił klucz API (sprawdź ELEVENLABS_API_KEY).'), { fatal: true, quota });
    }
    if (res.status === 404 || res.status === 422) throw Object.assign(new Error('ElevenLabs odrzucił zapytanie (' + res.status + '). Sprawdź ELEVENLABS_VOICE_ID i ELEVENLABS_MODEL.'), { fatal: true });
    if (res.status === 429 || res.status >= 500) { await sleep(BACKOFF * (attempt + 1) * (res.status === 429 ? 2 : 1)); continue; }
    throw Object.assign(new Error('Nieoczekiwana odpowiedź ElevenLabs: ' + res.status), { fatal: true });
  }
  throw Object.assign(new Error('ElevenLabs nie odpowiada poprawnie po kilku próbach.'), { fatal: true });
}

async function main() {
  loadEnv();
  const cfg = { key: process.env.ELEVENLABS_API_KEY, voice: process.env.ELEVENLABS_VOICE_ID, model: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
    format: process.env.ELEVENLABS_FORMAT || 'mp3_44100_64', base: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '') };
  const idx = path.join(ROOT, 'index.html');
  if (!fs.existsSync(idx)) { console.error('Nie znaleziono ' + idx); { process.exitCode = 2; return; } }
  const texts = collectTexts(fs.readFileSync(idx, 'utf8'));
  const dir = path.join(ROOT, 'audio'), man = path.join(dir, 'manifest.json');
  fs.mkdirSync(dir, { recursive: true });
  let manifest = { v: 1, files: {} };
  try { const m = JSON.parse(fs.readFileSync(man, 'utf8')); if (m && m.files) manifest = m; } catch (e) { /* nowy */ }

  // kolizje skrótów (dwa różne teksty o tym samym kluczu) — niedopuszczalne
  const seen = new Map();
  for (const [k, t] of texts) { const h = auHash(t); if (seen.has(h) && seen.get(h) !== k) { console.error('Kolizja skrótu dla: "' + t + '" i "' + seen.get(h) + '". Zmień funkcję skrótu.'); { process.exitCode = 3; return; } } seen.set(h, k); }

  const todo = [], have = [];
  for (const [k, t] of texts) { const h = auHash(t); (fs.existsSync(path.join(dir, h + '.mp3')) ? have : todo).push({ h, t }); }
  const chars = todo.reduce((n, x) => n + x.t.length, 0);
  console.log('Teksty w aplikacji: ' + texts.size + ' · nagrane: ' + have.length + ' · do nagrania: ' + todo.length + ' (' + chars + ' znaków)');
  if (flag('dry')) { console.log('Tryb --dry: nic nie wysłano. Koszt = liczba znaków do nagrania × stawka Twojego planu w ElevenLabs.'); return; }
  if (!todo.length) { console.log('Wszystko już nagrane.'); writeManifest(); return; }

  if (!cfg.key) { console.error('Brak ELEVENLABS_API_KEY (zmienna środowiskowa albo plik tools/.env).'); { process.exitCode = 4; return; } }
  if (!cfg.voice) { console.error('Brak ELEVENLABS_VOICE_ID — wybierz głos w ElevenLabs i wpisz jego identyfikator.'); { process.exitCode = 4; return; } }

  function writeManifest() {
    // spis = wszystkie istniejące pliki z bieżącej listy tekstów
    const files = {};
    for (const [k, t] of texts) { const h = auHash(t); if (fs.existsSync(path.join(dir, h + '.mp3'))) files[h] = t; }
    manifest = { v: 1, voice: cfg.voice || manifest.voice, model: cfg.model || manifest.model, files };
    fs.writeFileSync(man + '.tmp', JSON.stringify(manifest, null, 1)); fs.renameSync(man + '.tmp', man);
  }
  let done = 0, failed = 0, stop = null;
  const queue = todo.slice();
  async function worker() {
    while (queue.length && !stop) {
      const it = queue.shift();
      try {
        const buf = await synth(it.t, cfg);
        if (!buf.length) throw Object.assign(new Error('Puste nagranie dla: ' + it.t), { fatal: false });
        const f = path.join(dir, it.h + '.mp3'); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f);
        done++; if (done % 10 === 0) { writeManifest(); console.log('  nagrano ' + done + '/' + todo.length); }
      } catch (e) { if (e.fatal) { stop = e; } else { failed++; console.error('  pominięto: ' + e.message); } }
    }
  }
  await Promise.all([worker(), worker()]);
  writeManifest();
  if (stop) { console.error('PRZERWANO: ' + stop.message + ' Nagrano ' + done + ' z ' + todo.length + '. Uruchom skrypt ponownie, gdy problem zniknie — dokończy od miejsca przerwania.'); { process.exitCode = stop.quota ? 5 : 1; return; } }
  console.log('Gotowe: nagrano ' + done + (failed ? ', pominięto ' + failed : '') + '. Teraz: git add audio && git commit && git push.');
}
main().catch(e => { console.error('Błąd: ' + e.message); { process.exitCode = 1; return; } });
