#!/usr/bin/env python3
"""
测试三个图像生成API的速度和质量对比
1. Tu-zi API (gemini-2.5-flash-image-vip)
2. AIIONLY API (gemini-2.5-flash-image-text)
3. Alibaba DashScope (z-image-turbo)
"""

import asyncio
import httpx
import time
import base64
from pathlib import Path
from datetime import datetime

# 测试输出目录
OUTPUT_DIR = Path(__file__).parent / "test_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# API配置
APIS = {
    "tuzi": {
        "name": "Tu-zi (gemini-2.5-flash-image-vip)",
        "url": "https://api.tu-zi.com/v1/chat/completions",
        "key": "REDACTED_API_KEY",
        "model": "gemini-2.5-flash-image-vip",
        "type": "openai"
    },
    "aiionly": {
        "name": "AIIONLY (gemini-2.5-flash-image-text)",
        "url": "https://api.aiionly.com/v1/chat/completions",
        "key": "REDACTED_API_KEY",
        "model": "gemini-2.5-flash-image-text",
        "type": "openai"
    },
    "dashscope": {
        "name": "Alibaba DashScope (z-image-turbo)",
        "url": "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        "key": "REDACTED_API_KEY",
        "model": "z-image-turbo",
        "type": "dashscope"
    }
}

# 怪物头像测试提示词
MONSTER_PROMPT = """Generate a fantasy monster avatar portrait for a D&D game token.
Monster: Goblin warrior
Style: Dark fantasy, detailed, painterly style
View: Front-facing portrait, centered
Background: Simple dark gradient
Size: Square format, suitable for game token
Quality: High detail on face and upper body"""

MONSTER_PROMPT_CN = """生成一个D&D游戏怪物头像。
怪物：地精战士
风格：暗黑奇幻，细节丰富，绘画风格
视角：正面肖像，居中
背景：简单深色渐变
格式：方形，适合游戏token使用
要求：面部和上半身细节丰富"""


import re

async def test_openai_style_api(api_config: dict, prompt: str) -> dict:
    """测试OpenAI风格的API (Tu-zi, AIIONLY)"""
    start_time = time.time()
    result = {
        "api": api_config["name"],
        "success": False,
        "time": 0,
        "error": None,
        "image_path": None
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                api_config["url"],
                headers={
                    "Authorization": f"Bearer {api_config['key']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": api_config["model"],
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "max_tokens": 4096
                }
            )

            elapsed = time.time() - start_time
            result["time"] = elapsed

            if response.status_code == 200:
                data = response.json()
                print(f"\n{api_config['name']} 响应结构:")
                print(f"  Keys: {data.keys()}")

                # 尝试提取图片
                if "choices" in data and len(data["choices"]) > 0:
                    choice = data["choices"][0]
                    message = choice.get("message", {})
                    content = message.get("content", "")

                    # 检查是否有图片数据
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "image_url":
                                img_url = item.get("image_url", {}).get("url", "")
                                if img_url.startswith("data:image"):
                                    img_data = img_url.split(",")[1]
                                    img_bytes = base64.b64decode(img_data)
                                    img_path = OUTPUT_DIR / f"{api_config['model']}_{datetime.now().strftime('%H%M%S')}.png"
                                    img_path.write_bytes(img_bytes)
                                    result["image_path"] = str(img_path)
                                    result["success"] = True
                    elif isinstance(content, str):
                        # 解析markdown格式的图片 ![xxx](url) 或 ![xxx](data:image/png;base64,xxx)
                        md_pattern = r'!\[.*?\]\((.*?)\)'
                        matches = re.findall(md_pattern, content)

                        for img_src in matches:
                            if img_src.startswith("data:image"):
                                # Base64图片
                                img_data = img_src.split(",")[1]
                                img_bytes = base64.b64decode(img_data)
                                img_path = OUTPUT_DIR / f"{api_config['model']}_{datetime.now().strftime('%H%M%S')}.png"
                                img_path.write_bytes(img_bytes)
                                result["image_path"] = str(img_path)
                                result["success"] = True
                                print(f"  提取到base64图片")
                                break
                            elif img_src.startswith("http"):
                                # URL图片，下载
                                print(f"  提取到图片URL: {img_src[:60]}...")
                                img_response = await client.get(img_src)
                                if img_response.status_code == 200:
                                    img_path = OUTPUT_DIR / f"{api_config['model']}_{datetime.now().strftime('%H%M%S')}.png"
                                    img_path.write_bytes(img_response.content)
                                    result["image_path"] = str(img_path)
                                    result["success"] = True
                                    break

                        if not result["success"]:
                            print(f"  Content (text): {content[:200]}...")
                            result["error"] = "未能从响应中提取图片"

                # 打印完整响应用于调试
                print(f"  Full response: {str(data)[:500]}...")
            else:
                result["error"] = f"HTTP {response.status_code}: {response.text[:200]}"

    except Exception as e:
        result["time"] = time.time() - start_time
        result["error"] = str(e)

    return result


async def test_dashscope_api(api_config: dict, prompt: str) -> dict:
    """测试阿里云DashScope API"""
    start_time = time.time()
    result = {
        "api": api_config["name"],
        "success": False,
        "time": 0,
        "error": None,
        "image_path": None
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                api_config["url"],
                headers={
                    "Authorization": f"Bearer {api_config['key']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": api_config["model"],
                    "input": {
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"text": prompt}
                                ]
                            }
                        ]
                    },
                    "parameters": {
                        "prompt_extend": True,
                        "size": "512*512"
                    }
                }
            )

            elapsed = time.time() - start_time
            result["time"] = elapsed

            if response.status_code == 200:
                data = response.json()
                print(f"\n{api_config['name']} 响应结构:")
                print(f"  Keys: {data.keys()}")

                # DashScope返回格式
                if "output" in data:
                    output = data["output"]
                    if "choices" in output and len(output["choices"]) > 0:
                        choice = output["choices"][0]
                        message = choice.get("message", {})
                        content = message.get("content", [])

                        for item in content:
                            if "image" in item:
                                img_url = item["image"]
                                # 下载图片
                                img_response = await client.get(img_url)
                                if img_response.status_code == 200:
                                    img_path = OUTPUT_DIR / f"{api_config['model']}_{datetime.now().strftime('%H%M%S')}.png"
                                    img_path.write_bytes(img_response.content)
                                    result["image_path"] = str(img_path)
                                    result["success"] = True
                                    break

                # 打印完整响应用于调试
                print(f"  Full response: {str(data)[:500]}...")
            else:
                result["error"] = f"HTTP {response.status_code}: {response.text[:200]}"

    except Exception as e:
        result["time"] = time.time() - start_time
        result["error"] = str(e)

    return result


async def main():
    print("=" * 60)
    print("图像生成API对比测试")
    print("=" * 60)
    print(f"\n测试提示词: {MONSTER_PROMPT_CN[:50]}...")
    print(f"输出目录: {OUTPUT_DIR}")

    results = []

    # 测试每个API
    for api_id, api_config in APIS.items():
        print(f"\n{'='*60}")
        print(f"测试: {api_config['name']}")
        print(f"{'='*60}")

        if api_config["type"] == "openai":
            result = await test_openai_style_api(api_config, MONSTER_PROMPT_CN)
        else:
            result = await test_dashscope_api(api_config, MONSTER_PROMPT_CN)

        results.append(result)

        # 打印结果
        print(f"\n结果:")
        print(f"  成功: {result['success']}")
        print(f"  耗时: {result['time']:.2f}秒")
        if result["error"]:
            print(f"  错误: {result['error']}")
        if result["image_path"]:
            print(f"  图片: {result['image_path']}")

    # 汇总
    print("\n" + "=" * 60)
    print("测试汇总")
    print("=" * 60)
    print(f"{'API':<40} {'成功':<6} {'耗时':<10}")
    print("-" * 60)
    for r in results:
        status = "✓" if r["success"] else "✗"
        print(f"{r['api']:<40} {status:<6} {r['time']:.2f}秒")

    # 按速度排序（仅成功的）
    successful = [r for r in results if r["success"]]
    if successful:
        print("\n速度排名（仅成功）:")
        for i, r in enumerate(sorted(successful, key=lambda x: x["time"]), 1):
            print(f"  {i}. {r['api']} - {r['time']:.2f}秒")


if __name__ == "__main__":
    asyncio.run(main())
