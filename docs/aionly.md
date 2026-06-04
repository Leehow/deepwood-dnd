Gemini 2.5 flash image
更新时间：2025-10-23 12:30:20
一、简介

本文介绍图片生成模型 gemini 2.5 flash image 的调用 API ，包括输入输出参数，取值范围，注意事项等信息，供您使用接口时查阅字段含义。

二、如何使用

在调用前，您需要开通模型服务并获取API Key，再配置API Key到环境变量，同时使用API_URL进行接口访问
API_URL：<https://api.aiionly.com>
URL全连接：<https://api.aiionly.com/v1/images/generations>

注意：模型生成的图片具有时效性，一般时长为1小时，请及时保存

三、参数说明

请求参数

参数名称 参数解释 必填 参数类型
model 模型名称 是 String
input 图片生成内容 是 Json字符串
input.prompt 文本描述
根据输入的文本智能生成相关的图像，建议详细描述画面主体、细节、场景等，文本描述越丰富，生成效果越精美。
示例值：雨中、竹林、小路 是 String
input.images 编辑图片、参考图片 有条件必填，图片编辑必填 Array
parameters 图片生成参数 **是（必填）** Json字符串
parameters.size 图片尺寸（如 "1024x1024"） **是（必填）** String
parameters.seed 随机种子（可选） 否 Integer
format 图片返回格式 否 String
model

模型中的Model ID，可在模型广场、开通管理中进行查看。

input.prompt

提示词（prompt）描述越完整、精确和丰富，生成的图片越贴近期望生成的内容。

input.images

编辑图片
String类型的集合
图片URL集合：请确保图片URL可被访问
Base64编码集合：请遵循此格式data:image/<图片格式>;base64,<Base64编码>，注意 <图片格式> 需小写，如 data:image/png;base64,{base64_image}。
示例：["data:image/png;base64,{base64_image}","data:image/png;base64,{base64_image}"]

**parameters（重要！必填字段）**

⚠️ **注意：parameters 字段是必填的，缺少此字段会导致 API 返回 500 错误！**

parameters.size：图片尺寸，必填。支持的尺寸包括：

- "512x512"
- "1024x1024"
- 其他支持的尺寸请参考 API 文档

parameters.seed：随机种子，可选。用于生成可复现的图片。

format

默认值：base64
图片返回格式有三个选项：url、base64、bytes。
url：图片url
base64：图片Base64字符串
bytes：图片字节流

示例代码

**基础示例（必须包含 parameters 字段）：**

```bash
curl -X POST ${API_URL}/v1/images/generations \
-H "Authorization: Bearer API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "gemini-2.5-flash-image",
    "input": {
        "prompt": "a cute cat"
    },
    "parameters": {
        "size": "1024x1024"
    },
    "format": "base64"
}'
```

**完整示例（包含所有可选参数）：**

```bash
curl -X POST ${API_URL}/v1/images/generations \
-H "Authorization: Bearer API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "gemini-2.5-flash-image",
    "input": {
        "prompt": "watch dog"
    },
    "parameters": {
        "size": "1024x1024",
        "seed": 42
    },
    "format": "base64"
}'
```

返回参数

参数名称 参数解释 参数类型
code 响应状态码 Integer
data 响应参数 List集合
data.url 图片URL合集 String
data.base64 图片Base64 String
data.bytes 图片字节流 String
usage 输出信息统计 Json字符串
usage.image_count 模型生成图片的数量 Integer
返回示例结果

{
    "code": 200,
    "data": [{"url":"${API_URL }/dog_and_girl.jpeg"}],
    "usage":{"image_count ":1}
}
