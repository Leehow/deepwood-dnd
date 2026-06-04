# 创建图像

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/images/generations:
    post:
      summary: 创建图像
      deprecated: false
      description: |+
        [图片](https://platform.openai.com/docs/api-reference/images)

        给定提示和/或输入图像，模型将生成新图像。

        相关指南：[图像生成](https://platform.openai.com/docs/guides/images)

        根据提示创建图像。

      tags:
        - openai/图像（Images）
      parameters:
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: 用于图像生成的模型。
                prompt:
                  type: string
                  description: 所需图像的文本描述。最大长度为 1000 个字符。
                'n':
                  type: integer
                  description: 要生成的图像数。必须介于 1 和 10 之间。
                size:
                  type: string
                  description: 生成图像的大小。必须是256x256、512x512或 1024x1024之一。
                quality:
                  type: string
                  description: 将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
                response_format:
                  type: string
                  description: 返回生成的图像的格式。必须是 或url之一b64_json。
                style:
                  type: string
                  description: >-
                    生成图像的大小。必须是`256x256`、`512x512`或`1024x1024`for之一`dall-e-2`。对于模型来说，必须是`1024x1024`、`1792x1024`、
                    或之一。`1024x1792``dall-e-3`
                user:
                  type: string
                  description: >-
                    生成图像的风格。必须是
                    或`vivid`之一`natural`。生动使模型倾向于生成超真实和戏剧性的图像。自然使模型生成更自然、不太真实的图像。此参数仅支持`dall-e-3`.
              required:
                - prompt
              x-apifox-orders:
                - prompt
                - model
                - 'n'
                - quality
                - response_format
                - style
                - user
                - size
            example:
              model: gpt-4o-image-vip-async
              prompt: 画一副清明上河图
              'n': 1
              size: 1024x1024
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  created:
                    type: integer
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        url:
                          type: string
                      required:
                        - url
                      x-apifox-orders:
                        - url
                required:
                  - created
                  - data
                x-apifox-orders:
                  - created
                  - data
              example:
                created: 1589478378
                data:
                  - url: https://...
                  - url: https://...
          headers: {}
          x-apifox-name: Create image
      security:
        - bearer: []
      x-apifox-folder: openai/图像（Images）
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7040782/apis/api-343647071-run
components:
  schemas: {}
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
servers:
  - url: https://api.tu-zi.com
    description: api.tu-zi.com
security:
  - bearer: []

```



https://api.tu-zi.com/v1/chat/completions


# gpt-4o-image-vip

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/chat/completions:
    post:
      summary: gpt-4o-image-vip
      deprecated: false
      description: ''
      tags:
        - 图片生成/gpt4oimage/chat 格式
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                stream:
                  type: boolean
                model:
                  type: string
                messages:
                  type: array
                  items:
                    type: object
                    properties:
                      content:
                        type: string
                      role:
                        type: string
                    x-apifox-orders:
                      - content
                      - role
                    required:
                      - content
                      - role
              required:
                - stream
                - model
                - messages
              x-apifox-orders:
                - stream
                - model
                - messages
            example:
              stream: true
              model: gpt-4o-image-vip
              messages:
                - content: 画个千里江山，水墨风格
                  role: user
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security:
        - bearer: []
      x-apifox-folder: 图片生成/gpt4oimage/chat 格式
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7040782/apis/api-343646951-run
components:
  schemas: {}
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
servers:
  - url: https://api.tu-zi.com
    description: api.tu-zi.com
security:
  - bearer: []

```
