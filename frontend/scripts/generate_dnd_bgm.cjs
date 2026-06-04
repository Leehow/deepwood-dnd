#!/usr/bin/env node
/*
  DnD BGM generator using Tuzi Suno API
  - Sequential (no concurrency) per policy
  - Prints full logs to terminal
  - Saves responses and audio to frontend/debug/suno/dnd-bgm
  Usage:
    export TUZI_API_KEY=...  # ensure available
    node scripts/generate_dnd_bgm.cjs
*/

const fs = require('fs');
const path = require('path');

const TUZI_API_KEY = process.env.TUZI_API_KEY;
if (!TUZI_API_KEY) {
  console.error('[FATAL] Missing TUZI_API_KEY in environment. Please `export TUZI_API_KEY=...` before running.');
  process.exit(1);
}

const POLL_ONLY = process.env.POLL_ONLY === '1';
const POLL_IDS = (process.env.POLL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

const BASE_URL = 'https://api.tu-zi.com';
const OUT_DIR = path.resolve(__dirname, '../debug/suno/dnd-bgm');
const LOG_DIR = path.join(OUT_DIR, 'logs');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const headers = {
  'Authorization': `Bearer ${TUZI_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// Model version per docs: chirp-v3-0 or chirp-v3-5
const mv = 'chirp-v3-5';

let jobs = [
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
  {
    key: 'mystic_ethereal',
    title: 'DnD - Arcane Mysticism (Ethereal Vocals)',
    prompt:
      'Ambient fantasy underscore with a magical, mysterious aura. Shimmering pads, glassy textures, soft bells, faint low pulses, slow-evolving harmonies. Non-intrusive and loop-friendly for background use.',
    tags: 'ambient, fantasy, mystical, ethereal, pads, bells, texture, underscore',
    allow_wordless_vocals: true,
  },

  {
    key: 'mystic_ethereal_sacred',
    title: 'DnD - Sacred Mysticism (Optional Choir)',
    prompt:
      'Ambient fantasy underscore with a luminous, sacred aura. Shimmering pads, airy choir/vox swells, glass harmonics, soft bells, slow-evolving modal harmonies. Cathedralesque reverb and halo-like tails. Non-intrusive and loop-friendly for background use.',
    tags: 'ambient, fantasy, sacred, choir, cathedral, luminous, ethereal, pads, bells, texture',
    vocal_policy: 'optional',
  },
  {
    key: 'mystic_ethereal_grim',
    title: 'DnD - Grim Arcana (Eldritch Undercurrent)',
    prompt:
      'Dark ambient fantasy underscore with ominous, arcane tension. Low sub drones, bowed metal and singing bowls, dissonant clusters, sparse pulses, distant thumps; shadowy textures. Keep dynamics restrained and loop-friendly for background use.',
    tags: 'dark ambient, fantasy, ominous, eldritch, drones, tension, texture, bowed metal',
    vocal_policy: 'optional',
  },
  {
    key: 'mystic_ethereal_neutral',
    title: 'DnD - Neutral Arcana (Balanced Mystery)',
    prompt:
      'Ambient fantasy underscore with balanced mystery. Warm pads, glassy shimmer, soft bells, gentle low pulse, subtle evolving harmonies. Non-intrusive, loop-friendly, neutral mood for broad scenes.',
    tags: 'ambient, fantasy, neutral, mystery, pads, bells, texture, underscore',
    vocal_policy: 'optional',
  },
  {
    key: 'mystic_ethereal_mystery_plus',
    title: 'DnD - Deeper Mystery (Veiled Arcana)',
    prompt:
      'Ambient fantasy underscore with heightened mysteriousness. Ambiguous/modal harmony, evolving shimmering textures, reverse-like swells, delicate micro-motifs. Soft dynamics, non-intrusive, loop-friendly for background use.',
    tags: 'ambient, fantasy, mysterious, veiled, shimmer, pads, texture, underscore',
    vocal_policy: 'optional',
  },
  {
    key: 'mystic_ethereal_tension_plus',
    title: 'DnD - Quiet Tension (Under-the-Skin)',
    prompt:
      'Ambient fantasy underscore with a subtle sense of danger. Heartbeat-like low pulses, slow ostinati, quiet percussive ticks, friction textures; no jump-scare hits. Keep restrained dynamics and loop-friendly background focus.',
    tags: 'ambient, fantasy, tension, pulse, ostinato, subtle, texture',
    vocal_policy: 'optional',
  },
  {
    key: 'mystic_ethereal_space_plus',
    title: 'DnD - Vast Expanse (Wide Space)',
    prompt:
      'Ambient fantasy underscore with very wide spatial image. Cavernous/cathedral reverb, long tails, distant bells, airy high pads, deep sub drones. Slow-evolving and non-intrusive, loop-friendly for background use.',
    tags: 'ambient, fantasy, spacious, cathedral, cavern, reverb, pads, bells, drones',
    vocal_policy: 'optional',
  },

  {
    key: 'ref_down_by_the_river',
    title: 'DnD - Riverside Folk (Down-by-the-River Inspired)',
    prompt:
      'Ambient fantasy folk ballad with a gentle riverside mood. Modal (Dorian/Aeolian), soft fiddle/violin lines, airy flute/whistle, nylon/steel acoustic guitar or lute arpeggios, light frame-drum/percussion, warm pads; 70–85 BPM; melancholic yet hopeful; non-intrusive and loop-friendly for background use.',
    tags: 'ambient, fantasy, folk, celtic, riverside, fiddle, flute, acoustic, pads, melancholic, hopeful',
    vocal_policy: 'optional',
  },
];


// Optional: filter jobs by environment variable JOB_KEYS (comma-separated keys)
const JOB_KEYS = (process.env.JOB_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
if (JOB_KEYS.length) {
  const dict = Object.fromEntries(jobs.map(j => [j.key, j]));
  jobs = JOB_KEYS.map(k => dict[k]).filter(Boolean);
  console.log('[INIT] JOB_KEYS filter applied:', jobs.map(j => j.key).join(', '));
}

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

async function getJSON(url) {
  console.log('[HTTP] GET', url);
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('[HTTP] Non-JSON response (GET):', text);
    throw new Error('Failed to parse JSON: ' + e.message);
  }
  console.log('[HTTP] Status:', res.status, res.statusText);
  return json;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollAndDownload(jobId, job) {
  console.log(`[POLL] Start polling id=${jobId} for job=${job.key}`);
  const maxAttempts = 40; // ~ up to ~200s if interval=5s
  const intervalMs = 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[POLL] Attempt ${attempt}/${maxAttempts}`);
    const url = `${BASE_URL}/suno/fetch/${jobId}`;
    let data;
    try {
      data = await getJSON(url);
    } catch (e) {
      console.error('[POLL] GET error:', e && e.stack || e);
      await sleep(intervalMs);
      continue;
    }

    const pollPath = path.join(LOG_DIR, `${now()}_${job.key}_poll${attempt}.json`);
    fs.writeFileSync(pollPath, JSON.stringify(data, null, 2));
    console.log('[POLL] Saved poll response to', pollPath);

    // Flexible parsing: handle {clips:[...]}, {data:[...]}, {data:{data:[...]}} (/suno/fetch), or array
    let clips = [];
    if (data && Array.isArray(data.clips)) clips = data.clips;
    else if (data && Array.isArray(data.data)) clips = data.data;
    else if (data && data.data && Array.isArray(data.data.data)) clips = data.data.data;
    else if (Array.isArray(data)) clips = data;

    let anyDownloaded = false;
    if (Array.isArray(clips) && clips.length) {
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const st = c.status || c.state || 'unknown';
        console.log(`[POLL][CLIP ${i}] id=${c.id} status=${st}`);
        if (c.audio_url) {
          const file = path.join(OUT_DIR, `${job.key}_${i}.mp3`);
          try {
            await download(c.audio_url, file);
            anyDownloaded = true;
          } catch (e) {
            console.error(`[POLL][CLIP ${i}] Download error:`, e && e.stack || e);
          }
        }
      }
      if (anyDownloaded) {
        console.log('[POLL] Audio downloaded. Stop polling.');
        return;
      }
    }

    await sleep(intervalMs);
  }
  console.warn('[POLL] Max attempts reached without audio_url.');
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
  // Vocal policy: 'none' | 'wordless' | 'optional' (backward-compat: allow_wordless_vocals)
  let vocalPolicy = job.vocal_policy;
  if (vocalPolicy === undefined) {
    if (typeof job.allow_wordless_vocals !== 'undefined') {
      vocalPolicy = job.allow_wordless_vocals ? 'wordless' : 'none';
    } else {
      vocalPolicy = 'none';
    }
  }
  let promptSuffix;
  if (vocalPolicy === 'wordless') {
    promptSuffix = 'Wordless ethereal vocals (oohs/ahhs) used as atmospheric texture; no intelligible lyrics; background only.';
  } else if (vocalPolicy === 'optional') {
    promptSuffix = 'Optional faint wordless ethereal vocals may be used as subtle texture; avoid intelligible lyrics; keep mix unobtrusive; background only.';
  } else {
    promptSuffix = 'Instrumental only, no vocals.';
  }
  const payload = {
    // Using official format endpoint /suno/submit/music
    // Prompt assembled per job, defaulting to instrumental unless overridden
    prompt: `${job.prompt} ${promptSuffix}`,
    tags: job.tags,
    mv,
    title: job.title,
    infill_start_s: null,
    infill_end_s: null,
  };

  const json = await postJSON(`${BASE_URL}/suno/submit/music`, payload);
  const logPath = logFileName(job.key);
  fs.writeFileSync(logPath, JSON.stringify(json, null, 2));
  console.log('[LOG] Saved response to', logPath);

  // Normalize: direct result {id, clips, ...} or wrapped {code, data: {...}} or wrapped {code, data: "id"}
  const direct = (json && Array.isArray(json.clips)) ? json : null;
  const wrappedObj = (json && json.data && typeof json.data === 'object' && Array.isArray(json.data.clips)) ? json.data : null;
  const result = direct || wrappedObj || null;

  if (result) {
    const { id, status } = result;
    const clips = Array.isArray(result.clips) ? result.clips : [];
    console.log('[GEN] id:', id, 'status:', status, 'clips:', clips.length);
    let anyDownloaded = false;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i] || {};
      const st = c.status || 'unknown';
      console.log(`[CLIP ${i}] id=${c.id} status=${st} model=${c.model_name}`);
      if (c.audio_url) {
        const file = path.join(OUT_DIR, `${job.key}_${i}.mp3`);
        try {
          await download(c.audio_url, file);
          anyDownloaded = true;
        } catch (e) {
          console.error(`[CLIP ${i}] Download error:`, e && e.stack || e);
        }
      } else {
        console.warn(`[CLIP ${i}] audio_url not present in immediate response.`);
      }
    }
    if (!anyDownloaded) {
      console.warn('[GEN] No audio_url present in immediate response. If this persists, please provide polling endpoint.');
    }
    return;
  }

  const jobId = (json && typeof json.data === 'string') ? json.data : (json && json.id ? json.id : null);
  const topStatus = json && (json.status || (Array.isArray(json.clips) && json.clips[0] && json.clips[0].status));
  console.log('[GEN] Job id:', jobId, 'status:', topStatus);
  if (jobId) {
    console.log('[GEN] API returned job id without clips. Start polling via /v1/suno/feed ...');
    await pollAndDownload(jobId, job);
  } else {
    console.warn('[GEN] Neither clips[] nor job id found in response.');
  }
}

(async () => {
  console.log('[INIT] Output directory:', OUT_DIR);
  console.log('[INIT] Model version:', mv);
  console.log('[INIT] Jobs to run:', jobs.map(j => j.key).join(', '));
  for (let idx = 0; idx < jobs.length; idx++) {
    const job = jobs[idx];
    try {
      if (POLL_ONLY) {
        const id = POLL_IDS[idx];
        if (!id) {
          console.warn(`[SKIP] POLL_ONLY is set but missing POLL_IDS[${idx}] for job ${job.key}`);
        } else {
          console.log(`[ONLY-POLL] job=${job.key} id=${id}`);
          await pollAndDownload(id, job);
        }
      } else {
        await generateOne(job); // sequential by policy
      }
    } catch (err) {
      console.error('[ERROR]', job.key, err && err.stack || err);
      // No rollback / fallback per policy
    }
  }
  console.log('\n[DONE] All jobs processed.');
})();

