#!/usr/bin/env python3
"""
对比两个Chat API的速度
1. Infini AI (gpt-5-chat)
2. AIIONLY (gpt-5.2-chat)
"""

import asyncio
import httpx
import time

# API配置
APIS = {
    "infini": {
        "name": "Infini AI (gpt-5-chat)",
        "url": "https://cloud.infini-ai.com/maas/v1/chat/completions",
        "key": "sk-risikabgq4ke7h62",
        "model": "gpt-5-chat"
    },
    "aiionly": {
        "name": "AIIONLY (gpt-5.2-chat)",
        "url": "https://api.aiionly.com/v1/chat/completions",
        "key": "REDACTED_API_KEY",
        "model": "gpt-5.2-chat"
    }
}

# 测试提示词
TEST_PROMPTS = [
    "用一句话介绍D&D游戏",
    "写一个简短的地精怪物描述",
    "解释什么是先攻检定"
]


async def test_api(api_config: dict, prompt: str) -> dict:
    """测试单个API"""
    start_time = time.time()
    result = {
        "api": api_config["name"],
        "prompt": prompt[:30] + "...",
        "success": False,
        "time": 0,
        "ttfb": 0,  # Time to first byte
        "tokens": 0,
        "error": None,
        "response": None
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_config["url"],
                headers={
                    "Authorization": f"Bearer {api_config['key']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": api_config["model"],
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 200
                }
            )

            elapsed = time.time() - start_time
            result["time"] = elapsed

            if response.status_code == 200:
                data = response.json()
                result["success"] = True

                # 提取响应内容
                if "choices" in data and len(data["choices"]) > 0:
                    content = data["choices"][0].get("message", {}).get("content", "")
                    result["response"] = content[:100] + "..." if len(content) > 100 else content

                # 提取token使用量
                if "usage" in data:
                    result["tokens"] = data["usage"].get("total_tokens", 0)
            else:
                result["error"] = f"HTTP {response.status_code}: {response.text[:200]}"

    except Exception as e:
        result["time"] = time.time() - start_time
        result["error"] = str(e)

    return result


async def run_comparison():
    """运行对比测试"""
    print("=" * 70)
    print("Chat API 速度对比测试")
    print("=" * 70)

    all_results = {api_id: [] for api_id in APIS}

    for prompt in TEST_PROMPTS:
        print(f"\n测试提示词: {prompt}")
        print("-" * 70)

        # 并行测试两个API
        tasks = [test_api(APIS[api_id], prompt) for api_id in APIS]
        results = await asyncio.gather(*tasks)

        for result in results:
            api_id = "infini" if "Infini" in result["api"] else "aiionly"
            all_results[api_id].append(result)

            status = "✓" if result["success"] else "✗"
            print(f"  {result['api']}")
            print(f"    状态: {status}  耗时: {result['time']:.2f}s  Tokens: {result['tokens']}")
            if result["error"]:
                print(f"    错误: {result['error'][:80]}")
            elif result["response"]:
                print(f"    响应: {result['response'][:60]}...")

    # 汇总统计
    print("\n" + "=" * 70)
    print("汇总统计")
    print("=" * 70)
    print(f"{'API':<35} {'成功率':<10} {'平均耗时':<12} {'总Tokens':<10}")
    print("-" * 70)

    for api_id, results in all_results.items():
        success_count = sum(1 for r in results if r["success"])
        success_rate = f"{success_count}/{len(results)}"

        successful_times = [r["time"] for r in results if r["success"]]
        avg_time = sum(successful_times) / len(successful_times) if successful_times else 0

        total_tokens = sum(r["tokens"] for r in results)

        print(f"{APIS[api_id]['name']:<35} {success_rate:<10} {avg_time:.2f}s{'':<7} {total_tokens:<10}")

    # 速度对比
    infini_times = [r["time"] for r in all_results["infini"] if r["success"]]
    aiionly_times = [r["time"] for r in all_results["aiionly"] if r["success"]]

    if infini_times and aiionly_times:
        infini_avg = sum(infini_times) / len(infini_times)
        aiionly_avg = sum(aiionly_times) / len(aiionly_times)

        print("\n速度对比:")
        if infini_avg < aiionly_avg:
            faster = "Infini AI"
            ratio = aiionly_avg / infini_avg
        else:
            faster = "AIIONLY"
            ratio = infini_avg / aiionly_avg
        print(f"  {faster} 更快，约 {ratio:.1f}x")


if __name__ == "__main__":
    asyncio.run(run_comparison())
