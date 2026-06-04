#!/usr/bin/env python3
"""Benchmark DashScope TTS models for long text synthesis speed.

Usage:
    cd backend && source venv/bin/activate
    python ../scripts/test_tts_speed.py

Reads API key from PostgreSQL. Output goes to debug/test/tts_benchmark_results.txt
"""
import asyncio
import time
import os
import sys
import socket
import base64
import struct
import httpx

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.join(SCRIPT_DIR, "..")
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
sys.path.insert(0, BACKEND_DIR)

DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"
PSQL_BIN = "/opt/homebrew/Cellar/postgresql@17/17.7/bin/psql"
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "debug", "test")

# Force IPv4 (same as voice.py)
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_prefer(*a, **kw):
    r = _orig_getaddrinfo(*a, **kw)
    v4 = [x for x in r if x[0] == socket.AF_INET]
    return v4 if v4 else r

# Long test text (~280 chars)
TEST_TEXT = (
    "黑暗笼罩着整座城镇，远处传来低沉的雷声。"
    "冒险者们站在破旧的酒馆门口，手中紧握着武器。"
    "矮人战士格朗德举起他的战斧，咒骂了一声。"
    "精灵游侠艾拉搭箭在弦，目光锐利地扫视着前方的废墟。"
    "半身人盗贼菲恩悄无声息地溶入了阴影之中。"
    "人类法师莫兰翻开厚重的法术书，口中念念有词。"
    "他们即将踏入失落的矿坑，传说那里沉睡着一条年轻的黑龙。"
    "地精们在矿坑中建立了据点，劫掠过往的商队。"
    "领主悬赏五百金币，清除这些祸害。"
    "酒馆老板沙哑着嗓子说，上一支冒险队已经三天没有消息了。"
    "莫兰推了推眼镜，那可能意味着他们已经遇难了。"
    "格朗德哼了一声，那帮菜鸟，看我们的吧。"
    "他们出发了，沿着蜿蜒的山路向矿坑进发。"
)

VC_DEFAULT_VOICE = "qwen-tts-vc-dwnpc60s-voice-20260202170345613-c5c0"


async def get_api_key() -> str:
    """Read DashScope API key from PostgreSQL."""
    proc = await asyncio.create_subprocess_exec(
        PSQL_BIN, "-U", "haoli", "-d", "dnd_platform", "-t", "-A",
        "-c", "SELECT api_key FROM ai_model_configs WHERE model_type='TTS'",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    key = stdout.decode().strip()
    if key:
        return key
    key = os.getenv("DASHSCOPE_API_KEY", "")
    if not key:
        print("[ERROR] No API key found.")
        sys.exit(1)
    return key


async def test_rest(client, api_key, model_name, voice, text) -> dict:
    """Test REST API model."""
    url = f"{DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model_name, "input": {"text": text, "voice": voice, "language_type": "Chinese"}}

    t0 = time.perf_counter()
    try:
        resp = await client.post(url, json=payload, headers=headers)
        elapsed = time.perf_counter() - t0
        if resp.status_code == 200:
            data = resp.json()
            audio = data.get("output", {}).get("audio")
            audio_url = audio.get("url") if isinstance(audio, dict) else audio
            audio_size = 0
            if audio_url:
                try:
                    hr = await client.get(audio_url)
                    audio_size = len(hr.content)
                except Exception:
                    pass
            return {"ok": True, "time": elapsed, "size_kb": round(audio_size / 1024, 1)}
        else:
            return {"ok": False, "time": elapsed, "err": resp.text[:150]}
    except httpx.TimeoutException:
        return {"ok": False, "time": -1, "err": "TIMEOUT"}
    except Exception as e:
        return {"ok": False, "time": -1, "err": str(e)[:150]}


def test_vc_websocket(api_key, model_name, voice, text) -> dict:
    """Test VC WebSocket model (blocking, runs in thread)."""
    import threading
    import dashscope
    from dashscope.audio.qwen_tts_realtime import (
        QwenTtsRealtime, QwenTtsRealtimeCallback, AudioFormat,
    )

    socket.getaddrinfo = _ipv4_prefer
    dashscope.api_key = api_key

    class Cb(QwenTtsRealtimeCallback):
        def __init__(self):
            self.done = threading.Event()
            self.audio = bytearray()
            self.error_msg = None
        def on_open(self): pass
        def on_close(self, code, msg): self.done.set()
        def on_event(self, resp):
            if resp.get("type") == "response.audio.delta":
                self.audio.extend(base64.b64decode(resp.get("delta", "")))
        def on_error(self, resp):
            self.error_msg = str(resp)[:200]
            self.done.set()

    t0 = time.perf_counter()
    try:
        cb = Cb()
        client = QwenTtsRealtime(
            model=model_name, callback=cb,
            url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        )
        client.connect()
        client.update_session(
            voice=voice,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode="server_commit",
        )

        # Send text in chunks like voice.py does
        import re
        if len(text) <= 200:
            chunks = [text]
        else:
            parts = re.split(r'(?<=[。！？.!?\n])', text)
            chunks, buf = [], ""
            for p in parts:
                if len(buf) + len(p) > 200:
                    if buf: chunks.append(buf)
                    buf = p
                else:
                    buf += p
            if buf: chunks.append(buf)

        for chunk in chunks:
            client.append_text(chunk)
            time.sleep(0.1)

        time.sleep(0.2)
        client.finish()
        cb.done.wait(timeout=120)
        elapsed = time.perf_counter() - t0

        if cb.error_msg:
            return {"ok": False, "time": elapsed, "err": cb.error_msg[:100]}

        pcm = bytes(cb.audio)
        if not pcm:
            return {"ok": False, "time": elapsed, "err": "Empty audio"}

        return {"ok": True, "time": elapsed, "size_kb": round(len(pcm) / 1024, 1)}

    except Exception as e:
        elapsed = time.perf_counter() - t0
        return {"ok": False, "time": elapsed, "err": str(e)[:150]}


async def main():
    api_key = await get_api_key()
    print(f"API Key: {api_key[:8]}***")
    print(f"Test text: {len(TEST_TEXT)} chars")
    print("=" * 70)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    results = []

    # Define all tests: (model, voice, desc, type)
    tests = [
        ("qwen3-tts-vc-realtime-2026-01-15", VC_DEFAULT_VOICE, "qwen3-tts-vc-realtime (克隆, 当前)", "ws"),
        ("qwen3-tts-flash", "Cherry", "qwen3-tts-flash Cherry (REST)", "rest"),
        ("qwen3-tts-flash", "Ethan", "qwen3-tts-flash Ethan (REST)", "rest"),
        ("qwen-tts", "Cherry", "qwen-tts Cherry (旧版REST)", "rest"),
    ]

    async with httpx.AsyncClient(timeout=90.0) as client:
        for model, voice, desc, typ in tests:
            print(f"\nTesting: {desc}...")

            if typ == "ws":
                res = await asyncio.to_thread(test_vc_websocket, api_key, model, voice, TEST_TEXT)
            else:
                res = await test_rest(client, api_key, model, voice, TEST_TEXT)

            res["model"] = model
            res["voice"] = voice[:20]
            res["desc"] = desc
            results.append(res)

            if res["ok"]:
                print(f"  -> OK: {res['time']:.2f}s, audio={res.get('size_kb', '?')}KB")
            else:
                print(f"  -> FAIL: {res.get('err', '?')[:100]}")

            await asyncio.sleep(1)

    # Summary
    print("\n" + "=" * 70)
    print(f"{'Model':<42} {'Time':>7} {'Audio':>8}  Status")
    print("-" * 70)

    lines = [
        f"TTS Benchmark - {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Text: {len(TEST_TEXT)} chars", "",
        f"{'Model':<42} {'Time':>7} {'Audio':>8}  Status",
        "-" * 70,
    ]

    for r in results:
        if r["ok"]:
            line = f"{r['desc']:<42} {r['time']:>6.2f}s {r.get('size_kb','?'):>6}KB  OK"
        else:
            line = f"{r['desc']:<42} {'N/A':>7} {'N/A':>8}  FAIL: {r.get('err','')[:25]}"
        print(line)
        lines.append(line)

    ok = [r for r in results if r["ok"]]
    if ok:
        fast = min(ok, key=lambda x: x["time"])
        slow = max(ok, key=lambda x: x["time"])
        s = f"\nFastest: {fast['desc']} ({fast['time']:.2f}s)"
        s += f"\nSlowest: {slow['desc']} ({slow['time']:.2f}s)"
        if len(ok) > 1:
            s += f"\nSpeedup: {slow['time']/fast['time']:.1f}x faster"
        print(s)
        lines.append(s)

    path = os.path.join(OUTPUT_DIR, "tts_benchmark_results.txt")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"\nSaved: {path}")


if __name__ == "__main__":
    asyncio.run(main())
