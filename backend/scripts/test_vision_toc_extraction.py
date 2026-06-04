"""
测试使用 Vision 模型提取 PDF 目录层级结构

使用方法:
    cd backend
    source venv/bin/activate
    python scripts/test_vision_toc_extraction.py [model_name] [pdf_path] [max_pages]

示例:
    python scripts/test_vision_toc_extraction.py qwen3-vl-flash
    python scripts/test_vision_toc_extraction.py qwen-vl-ocr
    python scripts/test_vision_toc_extraction.py qwen3-vl-plus

可用模型: qwen3-vl-flash, qwen-vl-ocr, qwen3-vl-plus
默认测试文件: docs/books/DND_5E_冒险模组_龙后宝山HDQ_副本.pdf
"""
import asyncio
import sys
import os
import json
import base64
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

import fitz  # PyMuPDF
import httpx


# 分析单页的 Prompt
PAGE_HEADING_PROMPT = """分析这个PDF页面，识别所有可见的标题及其层级。

## 层级判断规则（根据视觉特征）：
- **Level 1 (章)**：最大字号的标题，通常包含"第X章"、"Chapter"、"附录"等关键词
- **Level 2 (节)**：中等字号，通常有数字编号如"1."、"2."，或区域名称
- **Level 3 (小节)**：较小字号，子编号如"1A."、"10B."，或通用小节名如"发展"、"宝藏"、"奖励"

## 特殊规则：
- "地图：XXX" 或 "Map:" = Level 2
- 重复出现的标题如"发展"、"宝藏"在不同位置都是独立的条目
- 只提取这一页上可见的标题，不要猜测

## 输出格式（JSON数组）：
```json
[
  {"title": "标题文本", "level": 1},
  {"title": "另一个标题", "level": 2}
]
```

如果这一页没有明显的章节标题，返回空数组 `[]`。
只返回JSON，不要其他解释。"""


async def call_vision_api(
    api_url: str,
    api_key: str,
    model_name: str,
    image_base64: str,
    prompt: str
) -> str:
    """调用 Vision API"""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 确保 base64 格式正确
    if not image_base64.startswith("data:"):
        image_base64 = f"data:image/png;base64,{image_base64}"

    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_base64}},
                    {"type": "text", "text": prompt}
                ]
            }
        ],
        "max_tokens": 2000,
        "temperature": 0.1
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{api_url}/chat/completions",
            headers=headers,
            json=payload
        )

        if response.status_code != 200:
            raise Exception(f"Vision API error: {response.status_code} - {response.text}")

        result = response.json()
        return result.get("choices", [{}])[0].get("message", {}).get("content", "")


def pdf_page_to_base64(doc: fitz.Document, page_num: int, dpi: int = 150) -> str:
    """将 PDF 页面转换为 base64 图片"""
    page = doc[page_num]
    # 使用较高 DPI 以便模型能看清文字
    pix = page.get_pixmap(dpi=dpi)
    img_bytes = pix.tobytes("png")
    return base64.b64encode(img_bytes).decode("utf-8")


def pdf_pages_to_stitched_base64(doc: fitz.Document, page_nums: list, dpi: int = 150) -> str:
    """将多个 PDF 页面垂直拼接成一张长图"""
    from PIL import Image
    import io

    images = []
    for page_num in page_nums:
        page = doc[page_num]
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)

    # 计算总高度和最大宽度
    total_height = sum(img.height for img in images)
    max_width = max(img.width for img in images)

    # 创建拼接后的图片
    stitched = Image.new("RGB", (max_width, total_height), (255, 255, 255))
    y_offset = 0
    for img in images:
        stitched.paste(img, (0, y_offset))
        y_offset += img.height

    # 转换为 base64
    buffer = io.BytesIO()
    stitched.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def parse_headings_response(response: str) -> list:
    """解析模型返回的标题列表"""
    import re

    try:
        # 尝试提取 JSON
        json_match = re.search(r'\[[\s\S]*\]', response)
        if json_match:
            return json.loads(json_match.group())
        return []
    except json.JSONDecodeError:
        print(f"  [警告] JSON解析失败: {response[:100]}...")
        return []


async def extract_toc_from_pdf(
    pdf_path: str,
    api_url: str,
    api_key: str,
    model_name: str,
    max_pages: int = 20,
    dpi: int = 150,
    batch_size: int = 1  # 1=逐页, 5=每5页拼接
) -> list:
    """从 PDF 提取目录结构"""

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    pages_to_analyze = min(total_pages, max_pages)

    print(f"\n📄 PDF: {pdf_path}")
    print(f"   总页数: {total_pages}, 分析前 {pages_to_analyze} 页")
    print(f"   模型: {model_name}")
    print(f"   DPI: {dpi}, 批量: {batch_size}页/次")
    print("-" * 50)

    all_headings = []

    if batch_size > 1:
        # 批量模式：每 batch_size 页拼接成一张图
        for batch_start in range(0, pages_to_analyze, batch_size):
            batch_end = min(batch_start + batch_size, pages_to_analyze)
            page_nums = list(range(batch_start, batch_end))

            print(f"\n📖 分析第 {batch_start + 1}-{batch_end}/{pages_to_analyze} 页（拼接模式）...")

            # 拼接图片
            image_base64 = pdf_pages_to_stitched_base64(doc, page_nums, dpi)

            # 修改 prompt 说明是多页拼接
            batch_prompt = PAGE_HEADING_PROMPT.replace(
                "只提取这一页上可见的标题",
                f"这是第{batch_start + 1}到{batch_end}页拼接的长图，提取所有可见标题"
            )

            try:
                response = await call_vision_api(
                    api_url=api_url,
                    api_key=api_key,
                    model_name=model_name,
                    image_base64=image_base64,
                    prompt=batch_prompt
                )

                headings = parse_headings_response(response)

                if headings:
                    print(f"   找到 {len(headings)} 个标题:")
                    for h in headings:
                        level_marker = "  " * (h.get("level", 1) - 1) + "├─"
                        print(f"   {level_marker} [{h.get('level')}] {h.get('title')}")

                    # 标记页码范围
                    for h in headings:
                        h["page"] = f"{batch_start + 1}-{batch_end}"
                    all_headings.extend(headings)
                else:
                    print("   （无标题）")

            except Exception as e:
                print(f"   [错误] {e}")
    else:
        # 原有的逐页模式
        for page_num in range(pages_to_analyze):
            print(f"\n📖 分析第 {page_num + 1}/{pages_to_analyze} 页...")

            image_base64 = pdf_page_to_base64(doc, page_num, dpi)

            try:
                response = await call_vision_api(
                    api_url=api_url,
                    api_key=api_key,
                    model_name=model_name,
                    image_base64=image_base64,
                    prompt=PAGE_HEADING_PROMPT
                )

                headings = parse_headings_response(response)

                if headings:
                    print(f"   找到 {len(headings)} 个标题:")
                    for h in headings:
                        level_marker = "  " * (h.get("level", 1) - 1) + "├─"
                        print(f"   {level_marker} [{h.get('level')}] {h.get('title')}")

                    for h in headings:
                        h["page"] = page_num + 1
                    all_headings.extend(headings)
                else:
                    print("   （无标题）")

            except Exception as e:
                print(f"   [错误] {e}")

    doc.close()
    return all_headings


def build_toc_tree(headings: list) -> list:
    """将扁平的标题列表构建为层级树结构"""

    def find_parent(stack, level):
        """找到当前层级的父节点"""
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        return stack[-1] if stack else None

    root = []
    stack = []

    for h in headings:
        node = {
            "title": h["title"],
            "level": h["level"],
            "page": h.get("page"),
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
                # 没有父节点，作为顶级
                root.append(node)
            stack.append(node)

    return root


async def get_vision_config_from_db():
    """从数据库获取 Vision 模型配置"""
    from app.db.session import async_session_maker
    from app.services.ai_model_service import ai_model_service
    from app.models.ai_settings import ModelType

    async with async_session_maker() as db:
        config = await ai_model_service.get_model_config(db, ModelType.VISION)
        return {
            "api_url": config.api_url,
            "api_key": config.api_key,
            "model_name": config.model_name
        }


async def main():
    # 默认测试文件
    default_pdf = "/Users/haoli/leehow/code/dw/docs/books/DND_5E_冒险模组_龙后宝山HDQ_副本.pdf"

    # 解析命令行参数
    model_override = None
    pdf_path = default_pdf
    max_pages = 5  # 默认只测试5页以节省时间
    batch_size = 1  # 默认逐页

    for arg in sys.argv[1:]:
        if arg.startswith("qwen"):
            model_override = arg
        elif arg.endswith(".pdf"):
            pdf_path = arg
        elif arg.startswith("batch"):
            batch_size = int(arg.replace("batch", ""))
        elif arg.isdigit():
            max_pages = int(arg)

    if not os.path.exists(pdf_path):
        print(f"❌ 文件不存在: {pdf_path}")
        sys.exit(1)

    print("=" * 60)
    print("🔍 Vision TOC 提取测试")
    print("=" * 60)

    # 从数据库获取配置
    print("\n📡 从数据库获取 Vision 模型配置...")
    try:
        config = await get_vision_config_from_db()
        print(f"   API URL: {config['api_url']}")
        print(f"   DB Model: {config['model_name']}")

        # 如果指定了模型，覆盖数据库配置
        if model_override:
            config["model_name"] = model_override
            print(f"   ⚡ 使用指定模型: {model_override}")
    except Exception as e:
        print(f"❌ 获取配置失败: {e}")
        print("\n请确保已在 API Settings 中配置 Vision Recognition Model")
        sys.exit(1)

    # 提取 TOC
    headings = await extract_toc_from_pdf(
        pdf_path=pdf_path,
        api_url=config["api_url"],
        api_key=config["api_key"],
        model_name=config["model_name"],
        max_pages=max_pages,
        dpi=150,
        batch_size=batch_size
    )

    # 构建树结构
    print("\n" + "=" * 60)
    print("📋 提取的目录结构")
    print("=" * 60)

    toc_tree = build_toc_tree(headings)

    def print_tree(nodes, indent=0):
        for node in nodes:
            prefix = "  " * indent + ("├─ " if indent > 0 else "")
            page_info = f" (p.{node['page']})" if node.get('page') else ""
            print(f"{prefix}[L{node['level']}] {node['title']}{page_info}")
            if node.get("children"):
                print_tree(node["children"], indent + 1)

    print_tree(toc_tree)

    # 保存结果
    model_suffix = config["model_name"].replace("-", "_")
    batch_suffix = f"_batch{batch_size}" if batch_size > 1 else ""
    output_path = Path(pdf_path).stem + f"_toc_{model_suffix}{batch_suffix}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "source": pdf_path,
            "model": config["model_name"],
            "headings_flat": headings,
            "toc_tree": toc_tree
        }, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 结果已保存到: {output_path}")
    print(f"   共提取 {len(headings)} 个标题")


if __name__ == "__main__":
    asyncio.run(main())
