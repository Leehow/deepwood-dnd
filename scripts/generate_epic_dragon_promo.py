"""
使用 SkyReels API 生成龙与地下城史诗战斗宣传片。

输出内容:
1. MP4 视频文件
2. 同名 .prompt.txt，保存最终 prompt
3. 同名 .json，保存任务元信息
"""
import json
import os
import sys
import time
from datetime import datetime

import requests
from dotenv import load_dotenv


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))
load_dotenv(os.path.join(PROJECT_ROOT, "backend", ".env"))

SKYREELS_API_KEY = os.getenv("SKYREELS_API_KEY", "sk_1dbcbd6009d44977b022062212ce1832")
SKYREELS_BASE = os.getenv("SKYREELS_BASE", "https://api-gateway.skyreels.ai/api/v1")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "debug", "test")
VIDEO_PREFIX = "dnd_epic_dragon"

PROMPT = (
    "An epic Dungeons & Dragons cinematic promo trailer. A colossal ancient dragon erupts into "
    "motion above a dark fantasy tactical battle map, its wings casting massive shadows across "
    "the battlefield. The camera pushes in dramatically through glowing UI panels, initiative "
    "trackers, character stats, spell icons, and monster tokens as if the tabletop game has come "
    "alive. A party of adventurers stands against the dragon in a desperate last stand: a heavily "
    "armored paladin raises a radiant shield, a wizard unleashes a blazing fireball, a ranger "
    "fires enchanted arrows, and a rogue dashes through smoke and debris. The dragon breathes "
    "devastating fire across the grid, flames and sparks sweeping over miniature terrain, while "
    "arcane runes, magical shockwaves, embers, dust, and shattered stone fill the scene. Add "
    "rapid cinematic camera moves, dramatic parallax across the battle interface, subtle zooms, "
    "heroic silhouettes, intense spell collisions, and the feeling of a final boss encounter. "
    "Dark fantasy mood, ultra-detailed, high contrast, volumetric lighting, cinematic atmosphere, "
    "epic scale, polished game trailer look."
)

def submit_task() -> str:
    print("[1/4] 提交 SkyReels text2video 任务...")
    resp = requests.post(
        f"{SKYREELS_BASE}/video/text2video/submit",
        headers={"Content-Type": "application/json"},
        json={
            "api_key": SKYREELS_API_KEY,
            "prompt": PROMPT,
            "duration": 5,
            "sound": True,
        },
        timeout=30,
    )
    body = resp.json()
    print(f"  响应: {json.dumps(body, ensure_ascii=False, indent=2)}")

    if body.get("code") != 200:
        raise RuntimeError(f"提交失败: {body.get('msg', body)}")

    return body["task_id"]


def poll_task(task_id: str, max_wait: int = 600) -> dict:
    print(f"[2/4] 轮询任务状态，最多等待 {max_wait}s...")
    start = time.time()
    poll_interval = 10

    while time.time() - start < max_wait:
        resp = requests.get(
            f"{SKYREELS_BASE}/video/text2video/task/{task_id}",
            params={"api_key": SKYREELS_API_KEY},
            timeout=30,
        )
        body = resp.json()
        status = body.get("status", "unknown")
        elapsed = int(time.time() - start)
        print(f"  [{elapsed}s] 状态: {status}")

        if status == "success":
            return body
        if status == "failed":
            raise RuntimeError(f"任务失败: {body.get('msg', body)}")

        time.sleep(poll_interval)

    raise TimeoutError(f"超时 ({max_wait}s), task_id={task_id}")


def save_prompt_and_metadata(stem: str, task_id: str, result: dict) -> tuple[str, str]:
    prompt_path = f"{stem}.prompt.txt"
    metadata_path = f"{stem}.json"
    metadata = {
        "created_at": datetime.now().isoformat(),
        "video_prefix": VIDEO_PREFIX,
        "mode": "text2video",
        "task_id": task_id,
        "prompt": PROMPT,
        "result": result,
    }

    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(PROMPT)
        f.write("\n")

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return prompt_path, metadata_path


def download_video(data: dict, stem: str) -> str:
    video_url = data.get("data", {}).get("video_url")
    if not video_url:
        raise RuntimeError(f"响应中无 video_url: {data}")

    output_path = f"{stem}.mp4"
    print("[3/4] 下载视频...")
    print(f"  URL: {video_url}")
    resp = requests.get(video_url, stream=True, timeout=120)
    resp.raise_for_status()

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"  保存到: {output_path} ({size_mb:.1f} MB)")
    return output_path


def main() -> None:
    print("=" * 60)
    print("SkyReels 龙与地下城史诗宣传片生成")
    print("=" * 60)

    if not SKYREELS_API_KEY:
        raise RuntimeError("缺少 SKYREELS_API_KEY")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stem = os.path.join(OUTPUT_DIR, f"{VIDEO_PREFIX}_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

    task_id = submit_task()
    print(f"  task_id: {task_id}")
    result = poll_task(task_id)
    video_path = download_video(result, stem)
    prompt_path, metadata_path = save_prompt_and_metadata(stem, task_id, result)

    print("[4/4] 已保存 prompt 和任务元信息")
    print(f"  prompt: {prompt_path}")
    print(f"  metadata: {metadata_path}")
    print()
    print("=" * 60)
    print(f"视频已生成: {video_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
