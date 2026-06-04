"""
测试使用正则提取标题 + 思考模型整理层级

使用方法:
    cd backend
    source venv/bin/activate
    python scripts/test_regex_toc_extraction.py [markdown_path]

默认测试文件: 使用最新上传的模组
"""
import asyncio
import sys
import os
import json
import re
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx


# 整理层级的 Prompt
REORGANIZE_PROMPT = """你是一个D&D模组目录整理专家。下面是从PDF中提取的所有标题（按出现顺序），请根据语义重新分配正确的层级。

## 层级规则：
- **Level 1**：章节标题（"第X章"、"Chapter"、"简介"、"附录"）
- **Level 2**：小节标题（地图、区域名称、任务类型如"奖励"、"发展"）
- **Level 3**：子小节（具体房间、具体遭遇）

## 特殊规则：
- "简介 Introduction" 和 "背景 Background" 在文档开头是 Level 1
- 但如果它们出现在某章节内部，则是 Level 2
- "地图 Map:" 开头的都是 Level 2
- 重复的标题如"奖励"在不同章节出现都是独立的 Level 2

## 输入标题列表：
{headings}

## 输出格式（JSON数组）：
```json
[
  {{"title": "简介 Introduction", "level": 1}},
  {{"title": "背景 Background", "level": 2}},
  {{"title": "第 1 章：火中至绿", "level": 1}},
  {{"title": "任务 Missions", "level": 2}}
]
```

只返回JSON数组，不要其他解释。确保保持原有顺序，只修改level值。"""


async def call_llm_api(
    api_url: str,
    api_key: str,
    model_name: str,
    prompt: str
) -> str:
    """调用 LLM API"""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 8000,
        "temperature": 0.1
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{api_url}/chat/completions",
            headers=headers,
            json=payload
        )

        if response.status_code != 200:
            raise Exception(f"LLM API error: {response.status_code} - {response.text}")

        result = response.json()
        return result.get("choices", [{}])[0].get("message", {}).get("content", "")


def extract_headings_from_markdown(md_path: str) -> list:
    """从 Markdown 文件中提取所有标题"""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    headings = []
    # 匹配 # 开头的标题行
    pattern = r'^(#{1,6})\s+(.+)$'

    for line_num, line in enumerate(content.split('\n'), 1):
        match = re.match(pattern, line.strip())
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            # 过滤掉太短或无意义的标题
            if len(title) > 1 and not title.startswith('!'):
                headings.append({
                    "title": title,
                    "original_level": level,
                    "line": line_num
                })

    return headings


def parse_llm_response(response: str) -> list:
    """解析 LLM 返回的 JSON"""
    try:
        # 尝试提取 JSON
        json_match = re.search(r'\[[\s\S]*\]', response)
        if json_match:
            return json.loads(json_match.group())
        return []
    except json.JSONDecodeError as e:
        print(f"  [警告] JSON解析失败: {e}")
        return []


async def get_advanced_model_config():
    """从数据库获取 Advanced 模型配置"""
    from app.db.session import async_session_maker
    from app.services.ai_model_service import ai_model_service
    from app.models.ai_settings import ModelType

    async with async_session_maker() as db:
        config = await ai_model_service.get_model_config(db, ModelType.ADVANCED)
        return {
            "api_url": config.api_url,
            "api_key": config.api_key,
            "model_name": config.model_name
        }


def build_toc_tree(headings: list) -> list:
    """将扁平的标题列表构建为层级树结构"""

    def find_parent(stack, level):
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        return stack[-1] if stack else None

    root = []
    stack = []

    for h in headings:
        node = {
            "title": h["title"],
            "level": h["level"],
            "children": []
        }

        if h["level"] == 1:
            root.append(node)
            stack = [node]
        else:
            parent = find_parent(stack, h["level"])
            if parent:
                parent["children"].append(node)
            else:
                root.append(node)
            stack.append(node)

    return root


async def main():
    # 默认使用最新的模组
    default_md = "/Users/haoli/leehow/code/dw/dnd-platform/upload/ef4d298f-d011-4acb-9f22-8fdefa04fdfe/converted/converted.md"

    # 从命令行参数获取路径
    md_path = sys.argv[1] if len(sys.argv) > 1 else default_md

    if not os.path.exists(md_path):
        print(f"❌ 文件不存在: {md_path}")
        sys.exit(1)

    print("=" * 60)
    print("🔍 正则 + 思考模型 TOC 提取测试")
    print("=" * 60)

    # Step 1: 正则提取标题
    print("\n📝 Step 1: 正则提取标题...")
    headings = extract_headings_from_markdown(md_path)
    print(f"   找到 {len(headings)} 个标题")

    if len(headings) == 0:
        print("❌ 未找到任何标题")
        sys.exit(1)

    # 显示前20个
    print("\n   前20个标题预览：")
    for h in headings[:20]:
        print(f"   [L{h['original_level']}] {h['title'][:50]}...")

    # Step 2: 获取 Advanced 模型配置
    print("\n📡 Step 2: 获取 Advanced 模型配置...")
    try:
        config = await get_advanced_model_config()
        print(f"   API URL: {config['api_url']}")
        print(f"   Model: {config['model_name']}")
    except Exception as e:
        print(f"❌ 获取配置失败: {e}")
        sys.exit(1)

    # Step 3: 调用思考模型整理层级
    print("\n🧠 Step 3: 调用思考模型整理层级...")

    # 准备标题列表（只发送标题文本）
    heading_texts = [h["title"] for h in headings]
    # 如果标题太多，只发送前200个
    if len(heading_texts) > 200:
        print(f"   标题过多({len(heading_texts)})，只处理前200个")
        heading_texts = heading_texts[:200]

    prompt = REORGANIZE_PROMPT.format(headings="\n".join(f"- {t}" for t in heading_texts))

    import time
    start_time = time.time()

    try:
        response = await call_llm_api(
            api_url=config["api_url"],
            api_key=config["api_key"],
            model_name=config["model_name"],
            prompt=prompt
        )
        elapsed = time.time() - start_time
        print(f"   耗时: {elapsed:.2f} 秒")

        # 解析结果
        reorganized = parse_llm_response(response)
        print(f"   整理后标题数: {len(reorganized)}")

    except Exception as e:
        print(f"❌ 调用失败: {e}")
        sys.exit(1)

    # Step 4: 构建树结构并输出
    print("\n" + "=" * 60)
    print("📋 整理后的目录结构")
    print("=" * 60)

    toc_tree = build_toc_tree(reorganized)

    def print_tree(nodes, indent=0):
        for node in nodes:
            prefix = "  " * indent + ("├─ " if indent > 0 else "")
            print(f"{prefix}[L{node['level']}] {node['title']}")
            if node.get("children"):
                print_tree(node["children"], indent + 1)

    print_tree(toc_tree)

    # 保存结果
    output_path = Path(md_path).parent.parent / "toc_regex_llm.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "source": md_path,
            "model": config["model_name"],
            "method": "regex + advanced LLM",
            "elapsed_seconds": elapsed,
            "headings_flat": reorganized,
            "toc_tree": toc_tree
        }, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 结果已保存到: {output_path}")
    print(f"   共整理 {len(reorganized)} 个标题")
    print(f"   总耗时: {elapsed:.2f} 秒")


if __name__ == "__main__":
    asyncio.run(main())
