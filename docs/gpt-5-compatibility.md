# GPT‑5 模型使用注意事项（兼容 API）

本文档用于说明：在本项目中使用供应商提供的 gpt‑5（Advanced Language Model）时，应避免设置 temperature、top_p、max_tokens 等参数；否则容易出现“只消耗 reasoning tokens、不产出可见文本”的现象。

## 适用范围
- 提供商：OpenAI 兼容接口（例如 https://cloud.infini-ai.com/maas/v1）
- 模型标识：gpt-5（作为 Advanced Language Model 使用）
- 本文档仅针对该模型的调用约束，其他模型不受此限制

## 不要设置的参数
在对 gpt‑5 发起请求时，请避免在 payload 中包含以下字段：
- temperature
- top_p
- max_tokens（以及部分厂商扩展：max_output_tokens 等）

原因：在我们的实际测试中，一旦设置上述采样或生成上限参数，gpt‑5 往往会将生成配额消耗在 `reasoning_tokens` 上，导致 `message.content` 为空字符串，即“推理但不出文本”。

### 典型失败特征（便于快速定位）
- HTTP 返回 200 OK，但：
  - `choices[0].message.content` 为空字符串
  - `choices[0].finish_reason` 为 `length`
  - `usage.completion_tokens_details.reasoning_tokens == usage.completion_tokens`

## 正确的调用规范
- 仅发送必要字段：`model` + `messages`
- 不要在请求中显式设置 `temperature`、`top_p`、`max_tokens`（以及 `max_output_tokens` 等扩展）
- 如果需要“返回 JSON”的效果，请在提示词中明确指示（例如 system 提示里写“仅返回严格 JSON”），而不是依赖 `response_format`
- 控制输入片段长度，尽量提供“聚焦窗口”（例如 TOC 窗口），减少模型进入纯推理模式的概率
- 严格串行调用，不做并发与自动回退（符合本仓库调试要求）

## 请求示例

正确示例（仅 model + messages）：

```json
{
  "model": "gpt-5",
  "messages": [
    {"role": "system", "content": "你是D&D模组解析专家，只返回严格 JSON。"},
    {"role": "user", "content": "……这里是任务/片段……"}
  ]
}
```

错误示例（包含不支持/不建议的字段）：

```json
{
  "model": "gpt-5",
  "messages": [ {"role": "user", "content": "……"} ],
  "temperature": 0.2,
  "top_p": 0.9,
  "max_tokens": 1500
}
```

## 在本项目中的落实
- `backend/app/domain/parsing/parsers/toc_ai.py`：针对 gpt‑5 的 AI 目录生成，已移除 temperature/top_p/max_tokens 等字段，仅保留 `model` 和 `messages`；并引入“TOC 窗口”裁剪，降低只产出 reasoning 的概率。
- 若其他模块需要直接调用 gpt‑5，请遵循“只传 `model`+`messages`”的规范；如需 JSON，请在提示词中声明“仅返回严格 JSON”。
- 已提供最小化调试脚本 `debug/test_ai_advanced_minimal.py`，可快速验证供应商返回是否包含可见文本内容。

## 调试与排查建议
1) 先用极小请求验证可输出文本（见 `debug/test_ai_advanced_minimal.py`）
2) 若任务较复杂，尽量缩短输入上下文（只保留必要片段）；必要时分阶段处理
3) 观察日志：如果出现 `finish_reason=length` 且 `message.content` 为空，多半是设置了不支持的采样/上限参数

## 变更影响
- 本说明为调用约束文档，不改变数据库模型与 API 配置页面行为
- 不影响其他非 gpt‑5 模型的常规用法

## 历史记录
- 2025‑11‑06：首次添加，结合 Dragonlance 模组的 AI TOC 实测行为整理

