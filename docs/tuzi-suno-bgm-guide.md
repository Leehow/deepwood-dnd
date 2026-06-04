# Tuzi Suno DnD BGM Generation Guide

This guide explains how to generate and download DnD background music (instrumental) using our Node.js script and Tuzi Suno API.

- Script: `frontend/scripts/generate_dnd_bgm.cjs`
- Output directory: `frontend/debug/suno/dnd-bgm/`
- Logs directory: `frontend/debug/suno/dnd-bgm/logs/`
- Policy: strictly sequential (no concurrency), print full logs, no rollback logic

## Prerequisites

1) Node.js 18+ (tested with Node v22)
2) A valid Tuzi API key exported as environment variable:

```bash
export TUZI_API_KEY="<your_api_key>"
```

Tip: If you keep the key in the repository `.env` (at repo root), you can source it before running:

```bash
set -a && [ -f .env ] && source .env || true && set +a
```

## Endpoints (as used by the script)

- Submit music task (returns a task_id):
  - `POST https://api.tu-zi.com/suno/submit/music`
  - Typical response: `{ "code":"success", "data": "<task_id>", "message":"" }`

- Fetch task result (query a single task by task_id to get clips with audio_url):
  - `GET https://api.tu-zi.com/suno/fetch/{task_id}`
  - Returns `clips` under nested `data.data` with `audio_url`, `status`, etc.

Note: We attempted `/v1/suno/feed` based on some docs, but production currently serves results via `/suno/fetch/{task_id}`.

## Modes of operation

The script supports two modes:

1) Generate + auto-download (default)
   - Submits new tasks (will incur API cost)
   - Polls each returned `task_id` using `/suno/fetch/{task_id}` until audio is available
   - Downloads each clip's `audio_url` (usually 2 clips per task)

2) Poll-only (no new submissions; no new cost)
   - Useful when you already have task_ids and just want to download audio
   - Controlled via environment variables `POLL_ONLY=1` and `POLL_IDS`

## Run: Generate new tracks (default mode)

```bash
cd frontend
# ensure TUZI_API_KEY is exported (see Prerequisites)
node scripts/generate_dnd_bgm.cjs
```

What happens:
- For each predefined job (8 scenarios), the script calls `/suno/submit/music`
- It saves the raw response JSON to `debug/suno/dnd-bgm/logs/`
- It starts polling `/suno/fetch/{task_id}` sequentially
- When `clips[].audio_url` appears, it downloads to `debug/suno/dnd-bgm/<job>_<index>.mp3`
- All steps are printed to the terminal (full logs)

## Run: Poll existing task_ids only (no new cost)

If you already have task IDs (from previous submits), you can download the audio without creating new tasks:

```bash
cd frontend
export POLL_ONLY=1
export POLL_IDS="<id_for_calm>,<id_for_battle>,<id_for_danger>,<id_for_comical>,<id_for_countryside>,<id_for_city>,<id_for_dungeon>,<id_for_tavern>"
node scripts/generate_dnd_bgm.cjs
```

Notes:
- The list in `POLL_IDS` must be in the same order as the internal `jobs` array (calm_exploration → tavern).
- The script will sequentially call `/suno/fetch/{task_id}` for each id, save the poll response JSON, and download mp3s.

## Output structure

- Audio files: `frontend/debug/suno/dnd-bgm/*.mp3`
  - Example: `calm_exploration_0.mp3`, `calm_exploration_1.mp3`, `battle_0.mp3`, etc.
- Log files: `frontend/debug/suno/dnd-bgm/logs/*.json`
  - Example (submit response): `2025-11-09T16-10-57-822Z_calm_exploration.json`
  - Example (poll response): `2025-11-09T16-32-04-856Z_calm_exploration_poll1.json`

## Customizing the jobs

Open `frontend/scripts/generate_dnd_bgm.cjs` and edit the `jobs` array:
- Each job has `key`, `title`, `prompt`, `tags`
- We already guide prompts toward instrumental-only; the script appends
  `"Instrumental only, no vocals."` to ensure no vocals.
- Model version `mv` is set near the top (default `chirp-v3-5`).

If you change job count or order, remember to adjust `POLL_IDS` accordingly for the poll-only mode.

## One-off curl checks

Check a single task quickly (ensure the key is exported):

```bash
curl -H "Authorization: Bearer $TUZI_API_KEY" \
     -H "Accept: application/json" \
     "https://api.tu-zi.com/suno/fetch/<task_id>"
```

The response should include `data.status: SUCCESS` and `data.data` as an array of clips with `audio_url`.

## Troubleshooting

- 401/403: Verify `TUZI_API_KEY` is correctly exported and not expired.
- 200 but no `audio_url` yet: The script polls sequentially with a fixed interval. If your task is still in progress, re-run later or increase polling duration inside the script.
- 404 on feed endpoints: Use `/suno/fetch/{task_id}` (current production behavior) instead of `/v1/suno/feed`.
- Empty audio files: Check terminal for download errors; ensure the CDN URL is reachable from your network.
- “Missing TUZI_API_KEY”: Export the variable before running.

## Policy & Notes

- No concurrency: The script is strictly sequential by design.
- Full logs: The script prints all HTTP requests/responses (truncated bodies are still saved to files).
- No rollback/fallback logic: Failures will be logged and the script proceeds to the next step/job.
- Costs: Submitting new tasks incurs API usage; poll-only mode does not.

## Typical workflow examples

1) Fresh generation of all 8 scenarios
```bash
cd frontend
export TUZI_API_KEY="<your_api_key>"
node scripts/generate_dnd_bgm.cjs
```

2) Download audio for previously created 8 tasks
```bash
cd frontend
export TUZI_API_KEY="<your_api_key>"
export POLL_ONLY=1
export POLL_IDS="<id1>,<id2>,<id3>,<id4>,<id5>,<id6>,<id7>,<id8>"
node scripts/generate_dnd_bgm.cjs
```

## FAQ

- Q: Where do I find the `task_id` after submitting?
  - A: The submit response is saved under `debug/suno/dnd-bgm/logs/` with the job key in the filename. The JSON will include the task id (usually under `data`).

- Q: Can I change the music style?
  - A: Yes, edit the `jobs` array prompts/tags. Keep them descriptive and include instrumentation hints. The script adds “no vocals” automatically.

- Q: Can I make it faster by running in parallel?
  - A: No. Parallel calls are disabled by policy. Keep it sequential to respect rate limits and logging requirements.

---
Last updated: 2025-11-09

