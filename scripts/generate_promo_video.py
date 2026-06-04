"""
使用 SkyReels API 生成深渊小屋宣传视频
1. 上传截图到 OSS 获取公网 URL
2. 调用 SkyReels image2video API
3. 轮询任务状态
4. 下载视频到 debug/test/
"""
import hashlib
import json
import os
import sys
import time
from datetime import datetime

import requests

# 项目路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_ROOT, "backend", ".env"))

# ---- 配置 ----
SKYREELS_API_KEY = "sk_1dbcbd6009d44977b022062212ce1832"
SKYREELS_BASE = "https://api-gateway.skyreels.ai/api/v1"
IMAGE_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/upload/ScreenShot_2026-03-17_220051_451.png")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "debug", "test")

PROMPT = (
    "A cinematic D&D tabletop game scene comes to life. The tactical battle map "
    "with grid lines slowly zooms in, revealing character tokens and monster figures. "
    "Magical spell effects shimmer across the battlefield as a dinosaur creature "
    "looms over the adventuring party. The character panel on the right displays "
    "detailed stats with glowing UI elements. Camera slowly pans across the dark "
    "fantasy interface with ambient particle effects and subtle lighting. "
    "Epic fantasy atmosphere, high quality, cinematic lighting."
)


def upload_to_oss(image_path: str) -> str:
    """上传图片到 OSS，返回公网 URL"""
    import oss2
    from app.core.config import settings

    print(f"[1/4] 上传图片到 OSS...")
    auth = oss2.Auth(settings.OSS_ACCESS_KEY_ID, settings.OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, settings.OSS_ENDPOINT, settings.OSS_BUCKET_NAME)

    with open(image_path, "rb") as f:
        data = f.read()

    data_hash = hashlib.sha256(data).hexdigest()[:8]
    date_path = datetime.now().strftime("%Y/%m/%d")
    object_key = f"dnd-promo/{date_path}/screenshot_{data_hash}.png"

    result = bucket.put_object(
        object_key, data,
        headers={"Content-Type": "image/png", "Cache-Control": "public, max-age=31536000"},
    )
    if result.status != 200:
        raise RuntimeError(f"OSS 上传失败: HTTP {result.status}")

    if settings.OSS_CDN_DOMAIN:
        url = f"https://{settings.OSS_CDN_DOMAIN}/{object_key}"
    else:
        url = f"https://{settings.OSS_BUCKET_NAME}.{settings.OSS_ENDPOINT}/{object_key}"

    print(f"  图片 URL: {url}")
    return url


def submit_task(image_url: str) -> str:
    """提交 image2video 任务，返回 task_id"""
    print(f"[2/4] 提交 SkyReels image2video 任务...")
    resp = requests.post(
        f"{SKYREELS_BASE}/video/image2video/submit",
        headers={"Content-Type": "application/json"},
        json={
            "api_key": SKYREELS_API_KEY,
            "prompt": PROMPT,
            "first_frame_image": image_url,
            "duration": 5,
            "sound": True,
        },
        timeout=30,
    )
    body = resp.json()
    print(f"  响应: {json.dumps(body, ensure_ascii=False, indent=2)}")

    if body.get("code") != 200:
        raise RuntimeError(f"提交失败: {body.get('msg', body)}")

    task_id = body["task_id"]
    print(f"  task_id: {task_id}")
    return task_id


def poll_task(task_id: str, max_wait: int = 600) -> dict:
    """轮询任务状态直到完成"""
    print(f"[3/4] 等待视频生成 (最多 {max_wait}s)...")
    start = time.time()
    poll_interval = 10

    while time.time() - start < max_wait:
        resp = requests.get(
            f"{SKYREELS_BASE}/video/image2video/task/{task_id}",
            params={"api_key": SKYREELS_API_KEY},
            timeout=30,
        )
        body = resp.json()
        status = body.get("status", "unknown")
        elapsed = int(time.time() - start)
        print(f"  [{elapsed}s] 状态: {status}")

        if status == "success":
            print(f"  生成完成!")
            return body
        elif status == "failed":
            raise RuntimeError(f"任务失败: {body.get('msg', body)}")

        time.sleep(poll_interval)

    raise TimeoutError(f"超时 ({max_wait}s), task_id={task_id}")


def download_video(data: dict) -> str:
    """下载视频到 debug/test/"""
    video_url = data.get("data", {}).get("video_url")
    if not video_url:
        raise RuntimeError(f"响应中无 video_url: {data}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filename = f"promo_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    output_path = os.path.join(OUTPUT_DIR, filename)

    print(f"[4/4] 下载视频...")
    print(f"  URL: {video_url}")
    resp = requests.get(video_url, stream=True, timeout=120)
    resp.raise_for_status()

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"  保存到: {output_path} ({size_mb:.1f} MB)")
    return output_path


def main():
    print("=" * 50)
    print("深渊小屋 (Deepwood) 宣传视频生成")
    print("=" * 50)

    if not os.path.exists(IMAGE_PATH):
        print(f"图片不存在: {IMAGE_PATH}")
        sys.exit(1)

    # Step 1: 上传图片
    image_url = upload_to_oss(IMAGE_PATH)

    # Step 2: 提交任务
    task_id = submit_task(image_url)

    # Step 3: 轮询
    result = poll_task(task_id)

    # Step 4: 下载
    video_path = download_video(result)

    print()
    print("=" * 50)
    print(f"宣传视频已生成: {video_path}")
    print("=" * 50)


if __name__ == "__main__":
    main()
