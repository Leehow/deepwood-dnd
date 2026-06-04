#!/usr/bin/env node
/*
  DnD BGM generator using Tuzi Suno API
  - Sequential (no concurrency) per policy
  - Prints full logs to terminal
  - Saves responses and audio to frontend/debug/suno/dnd-bgm
  Usage:
    export TUZI_API_KEY=...  # ensure available
    node scripts/generate_dnd_bgm.js
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

const headers = {
  'Authorization': `Bearer ${TUZI_API_KEY}`,
  'Content-Type': 'application/json',
};

// Model version per docs: chirp-v3-0 or chirp-v3-5
const mv = 'chirp-v3-5';

const jobs = [
  {
    key: 'calm_exploration',
    title: 'DnD - Calm Exploration',
    prompt:
      'Instrumental ambient fantasy exploration music. Calm, airy pads, light strings, soft woodwinds, subtle percussion. Suitable for relaxed travel and scene setting. No vocals, no lyrics.',
    tags: 'ambient, fantasy, orchestral, calm, instrumental, soft, pads',
  },
  {
    key: 'battle',
    title: 'DnD - Battle',
    prompt:
      'Instrumental epic orchestral battle music. Driving low percussion, fast strings, brass stabs, high tension, high tempo. No vocals.',
    tags: 'epic, orchestral, battle, action, dramatic, percussion',
  },
  {
    key: 'danger',
    title: 'DnD - Dangerous Ruins',
    prompt:
      'Instrumental dark ambient suspense music. Low drones, rattling textures, distant metallic hits, tense pulses, minimal melody. No vocals.',
    tags: 'dark ambient, suspense, tension, drones, cinematic',
  },
  {
    key: 'comical',
    title: 'DnD - Comical Hijinks',
    prompt:
      'Instrumental whimsical comedy music. Pizzicato strings, light woodwinds, xylophone, playful rhythm, quirky and fun. No vocals.',
    tags: 'whimsical, comedy, pizzicato, light, quirky, playful',
  },
  {
    key: 'countryside',
    title: 'DnD - Countryside',
    prompt:
      'Instrumental pastoral folk music. Acoustic guitar/lute, flute/whistle, gentle hand percussion, warm and peaceful. No vocals.',
    tags: 'folk, acoustic, pastoral, lute, flute, warm',
  },
  {
    key: 'city',
    title: 'DnD - Bustling City',
    prompt:
      'Instrumental medieval city market ambience with musicality. Lively folk instruments, light percussion, upbeat and social, yet not distracting. No vocals.',
    tags: 'medieval, market, folk, upbeat, light, instrumental',
  },
  {
    key: 'dungeon',
    title: 'DnD - Dungeon Depths',
    prompt:
      'Instrumental ominous dungeon ambience. Echoing percussion, low drones, subtle choral pads (wordless), sparse bells, eerie atmosphere. No vocals.',
    tags: 'dark ambient, dungeon, cavern, ominous, drones',
  },
  {
    key: 'tavern',
    title: 'DnD - Tavern',
    prompt:
      'Instrumental lively tavern folk tune. Fiddle/violin, lute, bodhran/hand drum, energetic but cozy, loopable. No vocals.',
    tags: 'tavern, folk, jig, fiddle, lute, upbeat',
  },
];

function now() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function logFileName(key) {
  return path.join(LOG_DIR, `${now()}_${key}.json`);
}

async function postJSON(url, body) {
  console.log('[HTTP] POST', url);
  console.log('[HTTP] Body:', JSON.stringify(body, null, 2));
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('[HTTP] Non-JSON response:', text);
    throw new Error('Failed to parse JSON: ' + e.message);
  }
  console.log('[HTTP] Status:', res.status, res.statusText);
  return json;
}

async function download(url, destPath) {
  console.log('[DL] Downloading', url, '->', destPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
  console.log('[DL] Saved', destPath, `${sizeMB}MB`);
}

async function generateOne(job) {
  console.log(`\n===== Generating: ${job.key} - ${job.title} =====`);
  const payload = {
    gpt_description_prompt: job.prompt,
    mv,
    prompt: '',
    make_instrumental: true, // 纯音乐
    tags: job.tags,
    title: job.title,
  };

  const json = await postJSON(`${BASE_URL}/v1/suno/generate`, payload);
  const logPath = logFileName(job.key);
  fs.writeFileSync(logPath, JSON.stringify(json, null, 2));
  console.log('[LOG] Saved response to', logPath);

  const topStatus = json.status || (Array.isArray(json.clips) && json.clips[0] && json.clips[0].status);
  console.log('[GEN] Job id:', json.id, 'status:', topStatus);

  if (Array.isArray(json.clips)) {
    for (let i = 0; i < json.clips.length; i++) {
      const c = json.clips[i];
      console.log(`[CLIP ${i}] id=${c.id} status=${c.status} model=${c.model_name}`);
      if (c.audio_url) {
        const file = path.join(OUT_DIR, `${job.key}_${i}.mp3`);
        try {
          await download(c.audio_url, file);
        } catch (e) {
          console.error(`[CLIP ${i}] Download error:`, e && e.stack || e);
        }
      } else {
        console.warn(`[CLIP ${i}] audio_url not ready in immediate response. Check later or use provider console.`);
      }
    }
  } else {
    console.warn('[GEN] No clips[] in response.');
  }
}

(async () => {
  console.log('[INIT] Output directory:', OUT_DIR);
  console.log('[INIT] Model version:', mv);
  console.log('[INIT] Jobs to run:', jobs.map(j => j.key).join(', '));
  for (const job of jobs) {
    try {
      await generateOne(job); // sequential by policy
    } catch (err) {
      console.error('[ERROR]', job.key, err && err.stack || err);
      // No rollback / fallback per policy
    }
  }
  console.log('\n[DONE] All jobs processed.');
})();

