#!/usr/bin/env node
/*
  Upload a local audio file to Tuzi Suno to obtain a reference id (e.g., audio_prompt_id or clip id).
  - Sequential only, prints full logs, saves response JSON under frontend/debug/suno/dnd-bgm/logs
  - Usage:
      export TUZI_API_KEY=...
      node frontend/scripts/suno_upload_audio.cjs --file "frontend/debug/suno/dnd-bgm/example/Borislav Slavov - Down By The River.mp3"
    Optional:
      --endpoint /suno/upload/audio  # default
*/

const fs = require('fs');
const path = require('path');

const TUZI_API_KEY = process.env.TUZI_API_KEY;
if (!TUZI_API_KEY) {
  console.error('[FATAL] Missing TUZI_API_KEY in environment. Please `export TUZI_API_KEY=...` before running.');
  process.exit(1);
}

const BASE_URL = 'https://api.tu-zi.com';
const OUT_DIR = path.resolve(__dirname, '../debug/suno/dnd-bgm');
const LOG_DIR = path.join(OUT_DIR, 'logs');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function now() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function logFileName(suffix) { return path.join(LOG_DIR, `${now()}_${suffix}.json`); }

// Parse args
let fileArg = null;
let endpoint = '/suno/upload/audio';
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--file') { fileArg = process.argv[++i]; }
  else if (a === '--endpoint') { endpoint = process.argv[++i]; }
}

if (!fileArg) {
  console.error('[FATAL] Missing --file <path-to-audio.mp3>');
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(filePath)) {
  console.error('[FATAL] File not found:', filePath);
  process.exit(1);
}

(async () => {
  console.log('[INIT] Uploading file:', filePath);
  const stat = fs.statSync(filePath);
  console.log('[INIT] Size:', stat.size, 'bytes');
  console.log('[INIT] Endpoint:', `${BASE_URL}${endpoint}`);

  const headers = {
    'Authorization': `Bearer ${TUZI_API_KEY}`
    // DO NOT set Content-Type when sending FormData
  };

  // Build FormData using Node 18+/22+ web APIs
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  const file = new File([blob], path.basename(filePath), { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', file);
  // Some providers require acknowledging TOS for audio uploads
  form.append('is_audio_upload_tos_accepted', 'true');

  console.log('[HTTP] POST', `${BASE_URL}${endpoint}`);
  const res = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST', headers, body: form });
  const text = await res.text();
  console.log('[HTTP] Status:', res.status, res.statusText);
  console.log('[HTTP] Raw response:', text.slice(0, 1000));

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('[ERROR] Failed to parse JSON:', e && e.message);
    const rawPath = logFileName('upload_raw');
    fs.writeFileSync(rawPath, text);
    console.log('[LOG] Saved raw response to', rawPath);
    process.exit(2);
  }

  const logPath = logFileName('upload');
  fs.writeFileSync(logPath, JSON.stringify(json, null, 2));
  console.log('[LOG] Saved JSON to', logPath);

  // Try to extract useful ids
  const candidates = [];
  function pushIf(v, label) { if (v) candidates.push({ label, value: v }); }
  pushIf(json.id, 'id');
  pushIf(json.data && json.data.id, 'data.id');
  pushIf(json.audio_prompt_id, 'audio_prompt_id');
  pushIf(json.data && json.data.audio_prompt_id, 'data.audio_prompt_id');
  pushIf(json.clip_id, 'clip_id');
  pushIf(json.data && json.data.clip_id, 'data.clip_id');

  if (candidates.length) {
    console.log('[RESULT] Extracted identifiers:');
    for (const c of candidates) console.log(`  - ${c.label}: ${c.value}`);
  } else {
    console.warn('[RESULT] No obvious id found. Inspect the saved JSON to determine the correct field.');
  }
})();

