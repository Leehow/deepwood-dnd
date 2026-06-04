
兔子Wiki
搜索...

/
/
04 gpt-image-1使用说明
了解如何生成或编辑图像。
页面内容
讨论
最后编辑
gongchengtu
08/18/2025
GPT-Image & DALL·E 图像 API 使用指南
目录
概述
模型比较
生成图像
编辑图像
使用图像参考创建新图像
使用掩码编辑图像（修复）
蒙版要求
自定义图像输出
尺寸和质量选项
输出格式
透明性
限制
内容审核
成本和延迟
概述
OpenAI API 允许您使用 gpt-image-1 或 DALL·E 模型根据文本提示生成和编辑图像（gpt-4o-image、gpt-4o-image-vip、gpt-image-1-vip一样操作）。
目前，图像生成可通过 图像 API 调用和 chat API调用（chat仅支持default分组的令牌）。
方式 特点
chat API 有返回进度，返回url；其中-vip模型还支持1次调用返回4图且不增加费用
图像 API 返回base64文件，响应比上面更快
🔗 Chat API 调用请跳转这里了解 apifox文档、代码示例；后文都是图像 API 的调用介绍。
🔗 如果您是comfy-ui用户可以看这篇文章在comfyui里使用4o生图
图像 API 提供三个端点，分别对应不同功能：
端点 作用
generate 根据文本提示生成图像
edit 修改现有图像（可使用新的提示、分区或整体替换）
variations 生成现有图像的变体（仅 DALL·E 2 可用）
您可以通过指定 质量、尺寸、格式、压缩率 以及 透明背景 等参数来自定义输出结果。
gpt-image-1调用需要在API令牌创建时选择OpenAI、OpenAI原价 或 default分组
价格上default<OpenAI<OpenAI原价 相差很大
速度上default<OpenAI<OpenAI原价 相差无几
lingpai.png
openai.png
模型比较
推荐：gpt-image-1 —— 原生多模态语言模型，图片质量高，且能借助世界知识完成复杂创作。
模型 端点支持 典型使用场景
DALL·E 2 generate / edit / variations 低成本、并发请求、遮罩修复
DALL·E 3 generate 更高图像质量，支持更大分辨率
GPT-Image (gpt-image-1) generate / edit
➡ 响应 API 即将推出 卓越指令遵循、文本渲染、细节编辑、真实世界知识
生成图像
使用 generate 端点根据文本提示创建图像。
通过 n 参数可一次性生成多张图像（默认返回 1 张）。
from openai import OpenAI
import base64
import requests
import os

# 从环境变量获取API密钥和基础URL

# 可以通过以下方式设置环境变量

# Windows (CMD)

# set TUZI_API_KEY=sk-your-api-key

# set TUZI_API_BASE=<https://api.tu-zi.com/v1>

# Windows (PowerShell)

# $env:TUZI_API_KEY="sk-your-api-key"

# $env:TUZI_API_BASE="<https://api.tu-zi.com/v1>"

# Linux/macOS

# export TUZI_API_KEY=sk-your-api-key

# export TUZI_API_BASE=<https://api.tu-zi.com/v1>

# 获取环境变量，如果未设置则使用默认值

api_key = os.environ.get("TUZI_API_KEY", "sk-**")
api_base = os.environ.get("TUZI_API_BASE", "<https://api.tu-zi.com/v1>")

client = OpenAI(
    base_url=api_base,
    api_key=api_key
)

result = client.images.generate(
    model="gpt-image-1",
    prompt="画一个孙悟空大战葫芦娃的画面，风格接近原画。"
)

print(result)
print(result.data)

image_base64 = result.data[0].b64_json
image_url = result.data[0].url

if image_base64:
    image_bytes = base64.b64decode(image_base64)
    with open("blackhole1.png", "wb") as f:
        f.write(image_bytes)
    print("图片已通过base64保存为 blackhole.png")
elif image_url:
    response = requests.get(image_url)
    response.raise_for_status()
    with open("blackhole.png", "wb") as f:
        f.write(response.content)
    print(f"图片已通过url下载并保存为 blackhole.png，url: {image_url}")
else:
    raise ValueError("API 没有返回图片的 base64 数据或图片链接！")
编辑图像
edit 端点支持：
对已有图片进行局部或整体编辑
使用一张或多张参考图像生成新图像
结合 遮罩（mask）进行“图像修复”
使用图像参考创建新图像
以下示例使用 4 张输入图片生成一个“Relax & Unwind”礼品篮（含所有参考物品）：

from openai import OpenAI
import base64
import requests
import os

# 从环境变量获取API密钥和基础URL

# 可以通过以下方式设置环境变量

# Windows (CMD)

# set TUZI_API_KEY=sk-your-api-key

# set TUZI_API_BASE=<https://api.tu-zi.com/v1>

# Windows (PowerShell)

# $env:TUZI_API_KEY="sk-your-api-key"

# $env:TUZI_API_BASE="<https://api.tu-zi.com/v1>"

# Linux/macOS

# export TUZI_API_KEY=sk-your-api-key

# export TUZI_API_BASE=<https://api.tu-zi.com/v1>

# 获取环境变量，如果未设置则使用默认值

api_key = os.environ.get("TUZI_API_KEY", "sk-**")
api_base = os.environ.get("TUZI_API_BASE", "<https://api.tu-zi.com/v1>")

client = OpenAI(
    base_url=api_base,
    api_key=api_key
)

result = client.images.edit(
    model="gpt-image-1",
    image=[
        open("blackhole.png", "rb"),
        open("blackhole1.png", "rb")
    ],
    prompt="将两幅图合并，生成一幅图，图上显示孙悟空大战葫芦娃的两个画面。"
)

print(result)
print(result.data)

image_base64 = result.data[0].b64_json
image_url = result.data[0].url

if image_base64:
    image_bytes = base64.b64decode(image_base64)
    with open("gift-basket.png", "wb") as f:
        f.write(image_bytes)
    print("图片已通过base64保存为 gift-basket.png")
elif image_url:
    response = requests.get(image_url)
    response.raise_for_status()
    with open("gift-basket.png", "wb") as f:
        f.write(response.content)
    print(f"图片已通过url下载并保存为 gift-basket.png，url: {image_url}")
else:
    raise ValueError("API 没有返回图片的 base64 数据或图片链接！")
¶ 使用掩码编辑图像（修复）
您可以提供一个遮罩来指示图像应编辑的位置。遮罩的透明区域将被替换，而黑色区域将保持不变。
您可以使用提示词来描述完整的新图像， 而不仅仅是擦除区域 。
如果您提供多个输入图像，遮罩将应用于第一个图像。
from openai import OpenAI
import base64
import requests
import os

# 从环境变量获取API密钥和基础URL

# 可以通过以下方式设置环境变量

# Windows (CMD)

# set TUZI_API_KEY=sk-your-api-key

# set TUZI_API_BASE=<https://api.tu-zi.com/v1>

# Windows (PowerShell)

# $env:TUZI_API_KEY="sk-your-api-key"

# $env:TUZI_API_BASE="<https://api.tu-zi.com/v1>"

# Linux/macOS

# export TUZI_API_KEY=sk-your-api-key

# export TUZI_API_BASE=<https://api.tu-zi.com/v1>

# 获取环境变量，如果未设置则使用默认值

api_key = os.environ.get("TUZI_API_KEY", "")
api_base = os.environ.get("TUZI_API_BASE", "<https://api.tu-zi.com/v1>")

client = OpenAI(
    base_url=api_base,
    api_key=api_key
)

result = client.images.edit(
    model="gpt-image-1",
    image=open("sunlit_lounge.png", "rb"),
    mask=open("mask.png", "rb"),
    prompt="A sunlit indoor lounge area with a pool containing a flamingo"
)

print(result)
print(result.data)

image_base64 = result.data[0].b64_json
image_url = result.data[0].url

if image_base64:
    image_bytes = base64.b64decode(image_base64)
    with open("composition.png", "wb") as f:
        f.write(image_bytes)
    print("图片已通过base64保存为 composition.png")
elif image_url:
    response = requests.get(image_url)
    response.raise_for_status()
    with open("composition.png", "wb") as f:
        f.write(response.content)
    print(f"图片已通过url下载并保存为 composition.png，url: {image_url}")
else:
    raise ValueError("API 没有返回图片的 base64 数据或图片链接！")
图像 面具 输出
  
提示：一个阳光照射的室内休息区，里面有一个养着火烈鸟的游泳池
蒙版要求
尺寸与格式：待编辑图像与遮罩必须一致，文件 ≤ 25 MB。
Alpha 通道：遮罩必须包含透明通道。
from PIL import Image
from io import BytesIO

# 1. Load your black & white mask as a grayscale image

mask = Image.open(img_path_mask).convert("L")

# 2. Convert it to RGBA so it has space for an alpha channel

mask_rgba = mask.convert("RGBA")

# 3. Then use the mask itself to fill that alpha channel

mask_rgba.putalpha(mask)

# 4. Convert the mask into bytes

buf = BytesIO()
mask_rgba.save(buf, format="PNG")
mask_bytes = buf.getvalue()

# 5. Save the resulting file

img_path_mask_alpha = "mask_alpha.png"
with open(img_path_mask_alpha, "wb") as f:
    f.write(mask_bytes)
自定义图像输出
您可以配置以下参数：
参数 说明
size 图片尺寸，如 1024x1024、1024x1536
quality 渲染质量：low / medium / high
format png (默认) / jpeg / webp
output_compression JPEG/WebP 压缩比 (0–100)
background transparent or opaque
尺寸和质量选项
尺寸
1024 × 1024 (正方形)
1536 × 1024 (横版)
1024 × 1536 (竖版)
auto (默认)
质量 （default分组不支持改参数）
low | medium | high | auto (默认)
输出格式
默认返回 Base64-PNG。若请求 jpeg或 webp 格式，可使用 output_compression 调整文件大小。
透明性
gpt-image-1 支持透明背景（仅 png / webp）。示例：
from openai import OpenAI
import base64
import requests
import os

# 从环境变量获取API密钥和基础URL

api_key = os.environ.get("TUZI_API_KEY", "")
api_base = os.environ.get("TUZI_API_BASE", "<https://api.tu-zi.com/v1>")

client = OpenAI(
    base_url=api_base,
    api_key=api_key
)

result = client.images.generate(
    model="gpt-image-1",
    prompt="Draw a 2D pixel art style sprite sheet of a tabby gray cat",
    size="1024x1024",
    background="transparent",
    quality="high",
)

print(result)
print(result.data)

image_base64 = result.data[0].b64_json
image_url = result.data[0].url

if image_base64:
    image_bytes = base64.b64decode(image_base64)
    with open("sprite.png", "wb") as f:
        f.write(image_bytes)
    print("图片已通过base64保存为 sprite.png")
elif image_url:
    response = requests.get(image_url)
    response.raise_for_status()
    with open("sprite.png", "wb") as f:
        f.write(response.content)
    print(f"图片已通过url下载并保存为 sprite.png，url: {image_url}")
else:
    raise ValueError("API 没有返回图片的 base64 数据或图片链接！")
限制
延迟：复杂提示最高可达 ≈ 2 分钟
文本渲染：相较 DALL·E 有改进，但仍可能不够清晰
一致性：跨多次生成时重复角色/品牌元素可能有差异
构图控制：布局敏感场景中，精确放置元素仍具挑战
内容审核
所有 提示 与 生成图像 都会经过内容政策过滤。
moderation 参数控制审核严格度：
值 说明
auto (默认) 标准过滤，屏蔽不适宜内容
low 限制更少，过滤宽松
成本和延迟
生成成本与“所用标记数”成正比——尺寸越大、质量越高，消耗标记越多。
质量 正方形 (1024×1024) 竖版 (1024×1536) 横版 (1536×1024)
低 272 tokens 408 tokens 400 tokens
中 1 056 tokens 1 584 tokens 1 568 tokens
高 4 160 tokens 6 240 tokens 6 208 tokens
计费(按token计费）：gpt-image-1 大约为官方的68%。详见价格页面。
评论
​

​

​

Markdown 格式
成为第一个发表评论的人。
Powered by Wiki.js
