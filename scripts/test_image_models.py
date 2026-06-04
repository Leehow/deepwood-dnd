#!/usr/bin/env python3
"""Test multiple AI image generation models and compare speed/quality."""

import asyncio
import base64
import time
import os
import json
import re
from pathlib import Path
from datetime import datetime

import httpx

OUTPUT_DIR = Path(__file__).parent.parent / "debug" / "test" / "image_test_results"
OUTPUT_DIR.mkdir(exist_ok=True)

PROMPT = """A highly detailed, photorealistic illustration of a traditional Chinese meat shop pork anatomy display board, mounted on a rustic wooden wall. The central focus is a large, anatomically accurate outline of a whole pig, drawn with clean, precise lines. The pig's body is divided into distinct sections using dashed lines to clearly indicate the boundaries of each meat cut. Each section is labeled with both Chinese and English text: '五花肉 / Pork Belly', '里脊 / Loin', '肩肉 / Shoulder Meat', '腿肉 / Ham', '前腿 / Front Leg', '后腿 / Back Leg', '肋排 / Ribs', '猪头 / Pig Head', '猪蹄 / Pig Feet', '猪尾 / Pig Tail'. Hyperrealistic style with warm lighting, food photography quality. 16:9 aspect ratio."""

SIZE_DASHSCOPE = "1536*1024"
SIZE_DISPLAY = "1536x1024"

MODELS = [
    {
        "name": "Qwen-Image-2.0",
        "base_url": "https://dashscope.aliyuncs.com",
        "api_key": os.environ.get("DASHSCOPE_API_KEY", ""),
        "model": "qwen-image-2.0",
        "type": "dashscope",
    },
    {
        "name": "Qwen-Image-2.0-Pro",
        "base_url": "https://dashscope.aliyuncs.com",
        "api_key": os.environ.get("DASHSCOPE_API_KEY", ""),
        "model": "qwen-image-2.0-pro",
        "type": "dashscope",
    },
    {
        "name": "Qwen-Image-Max",
        "base_url": "https://dashscope.aliyuncs.com",
        "api_key": os.environ.get("DASHSCOPE_API_KEY", ""),
        "model": "qwen-image-max",
        "type": "dashscope",
    },
    {
        "name": "Z-Image-Turbo",
        "base_url": "https://dashscope.aliyuncs.com",
        "api_key": os.environ.get("DASHSCOPE_API_KEY", ""),
        "model": "z-image-turbo",
        "type": "dashscope",
    },
    {
        "name": "gemini-3-pro-image-preview",
        "base_url": "https://yunwu.ai/v1",
        "api_key": os.environ.get("YUNWU_API_KEY", ""),
        "model": "gemini-3-pro-image-preview",
        "type": "yunwu",
    },
    {
        "name": "gemini-3.1-flash-image-preview",
        "base_url": "https://yunwu.ai/v1",
        "api_key": os.environ.get("YUNWU_API_KEY", ""),
        "model": "gemini-3.1-flash-image-preview",
        "type": "yunwu",
    },
    {
        "name": "gemini-2.5-flash-image",
        "base_url": "https://yunwu.ai/v1",
        "api_key": os.environ.get("YUNWU_API_KEY", ""),
        "model": "gemini-2.5-flash-image",
        "type": "yunwu",
    },
]


def safe_filename(name: str) -> str:
    return name.lower().replace(" ", "_").replace(".", "_").replace("-", "_")


async def test_dashscope(client: httpx.AsyncClient, cfg: dict) -> dict:
    """DashScope multimodal-generation endpoint (async task)."""
    url = f"{cfg['base_url']}/api/v1/services/aigc/multimodal-generation/generation"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": cfg["model"],
        "input": {
            "messages": [
                {"role": "user", "content": [{"text": PROMPT}]}
            ]
        },
        "parameters": {
            "n": 1,
            "size": SIZE_DASHSCOPE,
            "prompt_extend": True,
            "watermark": False,
        },
    }

    start = time.time()
    try:
        # Synchronous call - wait for result directly
        resp = await client.post(url, json=payload, headers=headers, timeout=300)
        elapsed = time.time() - start

        if resp.status_code != 200:
            return _fail(cfg, start, f"HTTP {resp.status_code}: {resp.text[:300]}")

        data = resp.json()

        # Extract image from response - check multiple formats
        # Format 1: output.choices[].message.content[] with image URLs
        choices = data.get("output", {}).get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", [])
            for part in (content if isinstance(content, list) else []):
                if isinstance(part, dict) and "image" in part:
                    img_url = part["image"]
                    ir = await client.get(img_url, timeout=60)
                    img_bytes = ir.content
                    fn = f"{safe_filename(cfg['name'])}.png"
                    fp = OUTPUT_DIR / fn
                    fp.write_bytes(img_bytes)
                    return _ok(cfg, elapsed, fp, img_bytes)

        # Format 2: output.results[] with url
        results = data.get("output", {}).get("results", [])
        if results:
            img_url = results[0].get("url", "")
            if img_url:
                ir = await client.get(img_url, timeout=60)
                img_bytes = ir.content
                fn = f"{safe_filename(cfg['name'])}.png"
                fp = OUTPUT_DIR / fn
                fp.write_bytes(img_bytes)
                return _ok(cfg, elapsed, fp, img_bytes)

        # Format 3: async task - need to poll
        task_id = data.get("output", {}).get("task_id")
        if task_id:
            poll_url = f"{cfg['base_url']}/api/v1/tasks/{task_id}"
            poll_h = {"Authorization": f"Bearer {cfg['api_key']}"}
            for _ in range(150):
                await asyncio.sleep(2)
                sr = await client.get(poll_url, headers=poll_h, timeout=30)
                if sr.status_code != 200:
                    continue
                sd = sr.json()
                st = sd.get("output", {}).get("task_status")
                if st == "SUCCEEDED":
                    elapsed = time.time() - start
                    ch = sd.get("output", {}).get("choices", [])
                    if ch:
                        cnt = ch[0].get("message", {}).get("content", [])
                        for p in (cnt if isinstance(cnt, list) else []):
                            if isinstance(p, dict) and "image" in p:
                                ir = await client.get(p["image"], timeout=60)
                                img_bytes = ir.content
                                fn = f"{safe_filename(cfg['name'])}.png"
                                fp = OUTPUT_DIR / fn
                                fp.write_bytes(img_bytes)
                                return _ok(cfg, elapsed, fp, img_bytes)
                    rs = sd.get("output", {}).get("results", [])
                    if rs and rs[0].get("url"):
                        ir = await client.get(rs[0]["url"], timeout=60)
                        img_bytes = ir.content
                        fn = f"{safe_filename(cfg['name'])}.png"
                        fp = OUTPUT_DIR / fn
                        fp.write_bytes(img_bytes)
                        return _ok(cfg, elapsed, fp, img_bytes)
                    return _fail(cfg, start, f"SUCCEEDED no image: {json.dumps(sd)[:200]}")
                elif st == "FAILED":
                    return _fail(cfg, start, f"Task failed: {sd.get('output',{}).get('message','')}")
            return _fail(cfg, start, "Poll timeout")

        # Save debug
        dbg = OUTPUT_DIR / f"{safe_filename(cfg['name'])}_debug.json"
        dbg.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        return _fail(cfg, start, f"Unknown response format. Debug: {dbg.name}")
    except Exception as e:
        return _fail(cfg, start, str(e))


async def test_yunwu(client: httpx.AsyncClient, cfg: dict) -> dict:
    """Yunwu/Gemini chat completions with image output."""
    url = f"{cfg['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "user", "content": f"Generate an image (1536x1024, 16:9): {PROMPT}"}
        ],
        "max_tokens": 4096,
    }

    start = time.time()
    try:
        resp = await client.post(url, json=payload, headers=headers, timeout=300)
        elapsed = time.time() - start

        if resp.status_code != 200:
            return _fail(cfg, start, f"HTTP {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return _fail(cfg, start, f"No choices")

        content = choices[0].get("message", {}).get("content", "")
        img_bytes = _extract_image(content)

        if img_bytes:
            fn = f"{safe_filename(cfg['name'])}.png"
            fp = OUTPUT_DIR / fn
            fp.write_bytes(img_bytes)
            return _ok(cfg, elapsed, fp, img_bytes)
        else:
            dbg = OUTPUT_DIR / f"{safe_filename(cfg['name'])}_debug.json"
            dbg.write_text(json.dumps(data, ensure_ascii=False, indent=2))
            return _fail(cfg, start, f"No image extracted. Debug saved: {dbg.name}")
    except Exception as e:
        return _fail(cfg, start, str(e))


def _extract_image(content):
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    return base64.b64decode(url.split(",", 1)[1])
            elif part.get("type") == "image" and "data" in part:
                return base64.b64decode(part["data"])
    elif isinstance(content, str):
        m = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=\s]+)', content)
        if m:
            return base64.b64decode(m.group(1).replace("\n", "").replace(" ", ""))
    return None


def _ok(cfg, elapsed, fp, img_bytes):
    return {
        "name": cfg["name"], "success": True, "time": elapsed,
        "file": str(fp), "size_kb": len(img_bytes) / 1024,
        "resolution": SIZE_DISPLAY,
    }


def _fail(cfg, start, error):
    return {
        "name": cfg["name"], "success": False,
        "error": error, "time": time.time() - start,
    }


async def test_model(client, cfg):
    print(f"  🔄 {cfg['name']}...")
    fn = test_dashscope if cfg["type"] == "dashscope" else test_yunwu
    r = await fn(client, cfg)
    if r["success"]:
        print(f"  ✅ {cfg['name']}: {r['time']:.1f}s, {r['size_kb']:.0f}KB")
    else:
        print(f"  ❌ {cfg['name']}: {r['error'][:100]}")
    return r


def generate_report(results):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ok = sorted([r for r in results if r["success"]], key=lambda x: x["time"])
    fail = [r for r in results if not r["success"]]

    lines = [
        "# AI 图片生成模型对比测试报告",
        "",
        f"**测试时间**: {now}  ",
        f"**测试模型数**: {len(results)} ({len(ok)} 成功, {len(fail)} 失败)  ",
        f"**目标分辨率**: {SIZE_DISPLAY} (约 16:9)  ",
        "",
        "## 结果汇总",
        "",
        "| # | 模型 | 平台 | 状态 | 生成时间 | 文件大小 |",
        "|---|------|------|------|----------|----------|",
    ]

    all_sorted = sorted(results, key=lambda x: (not x["success"], x["time"]))
    for i, r in enumerate(all_sorted, 1):
        plat = "阿里云 DashScope" if any(
            m["name"] == r["name"] and m["type"] == "dashscope" for m in MODELS
        ) else "Yunwu (Gemini)"
        st = "✅ 成功" if r["success"] else "❌ 失败"
        sz = f"{r['size_kb']:.0f} KB" if r.get("size_kb") else "-"
        lines.append(f"| {i} | **{r['name']}** | {plat} | {st} | {r['time']:.1f}s | {sz} |")

    # Speed ranking
    lines.extend(["", "## 速度排名", ""])
    if ok:
        for i, r in enumerate(ok, 1):
            medal = ["🥇", "🥈", "🥉"][i-1] if i <= 3 else f" {i}."
            lines.append(f"{medal} **{r['name']}** — {r['time']:.1f}s ({r['size_kb']:.0f} KB)")
    else:
        lines.append("*无成功结果*")

    # Images
    lines.extend(["", "## 生成图片展示", ""])
    for r in ok:
        fn = Path(r["file"]).name
        lines.extend([
            f"### {r['name']}",
            f"- **生成时间**: {r['time']:.1f}s",
            f"- **文件大小**: {r['size_kb']:.0f} KB",
            "",
            f"![{r['name']}](./{fn})",
            "",
        ])

    # Failed
    if fail:
        lines.extend(["## 失败模型", ""])
        for r in fail:
            lines.extend([
                f"### ❌ {r['name']} ({r['time']:.1f}s)",
                f"```",
                r.get("error", "unknown")[:300],
                "```",
                "",
            ])

    lines.append(f"\n---\n*自动生成于 {now}*")
    return "\n".join(lines)


async def main():
    print(f"🖼️  AI Image Model Comparison Test")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📁 Output: {OUTPUT_DIR}")
    print(f"🔄 Testing {len(MODELS)} models...\n")

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[test_model(client, m) for m in MODELS])

    report = generate_report(results)
    rp = OUTPUT_DIR / "report.md"
    rp.write_text(report, encoding="utf-8")
    print(f"\n📝 Report saved: {rp}")


if __name__ == "__main__":
    asyncio.run(main())
