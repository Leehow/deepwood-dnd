# 生成音乐

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成音乐
      deprecated: false
      description: |-
        生成音乐接口, 可以直接生成也可续写音乐

        如果是续写用户上传的音乐则需要在 mv 字段后面加个`-upload` 如 `chirp-v3-5-upload`
      tags:
        - 音乐生成/suno/suno官网原生格式/所有接口
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: 歌词内容,在自定义模式下需提供
                tags:
                  type: string
                  description: 歌曲风格标签,使用逗号分隔,在自定义模式下需提供
                mv:
                  type: string
                  description: 模型版本,可选值:chirp-v3-0、chirp-v3-5,默认为 chirp-v3-0
                title:
                  type: string
                  description: 歌曲标题,在自定义模式下需提供
                continue_clip_id:
                  type: string
                  description: 要续写的歌曲的 clip ID
                continue_at:
                  type: number
                  description: 从歌曲的第几秒开始续写
                infill_start_s:
                  type: 'null'
                infill_end_s:
                  type: 'null'
              required:
                - prompt
                - mv
              x-apifox-orders:
                - mv
                - prompt
                - tags
                - title
                - continue_clip_id
                - continue_at
                - infill_start_s
                - infill_end_s
            example: |-
              {
                  "prompt": "[Verse]\nStars they shine above me\nMoonlight softly glows\nWhispers in the night sky\nDreams that only grow\n\n[Verse 2]\nMidnight winds are calling\nCarrying a tune\nHeartbeats echo softly\nDancing with the moon\n\n[Chorus]\nStarry night starry night\nLet your light ignite ignite\nBright as day bright as day\nGuide my way guide my way\n\n[Verse 3]\nShadows move and twinkle\nNighttime come alive\nMystery in the heavens\nStories that survive\n\n[Bridge]\nMagic fills the darkness\nWonder in the air\nEvery star a secret\nIn the sky I stare\n\n[Chorus]\nStarry night starry night\nLet your light ignite ignite\nBright as day bright as day\nGuide my way guide my way",
                  "tags": "heavy metal",
                  "mv": "chirp-v3-5",
                  "title": "Starry ",
                  // "continue_clip_id": "2e584f32-7ae3-4b2d-93f6-391f65a01f15",
                  // "continue_at": 48.762,
                  "infill_start_s": null,
                  "infill_end_s": null
              }
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  clips:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        video_url:
                          type: string
                        audio_url:
                          type: string
                        image_url:
                          type: 'null'
                        image_large_url:
                          type: 'null'
                        is_video_pending:
                          type: boolean
                        major_model_version:
                          type: string
                        model_name:
                          type: string
                        metadata:
                          type: object
                          properties:
                            tags:
                              type: string
                            prompt:
                              type: string
                            gpt_description_prompt:
                              type: 'null'
                            audio_prompt_id:
                              type: string
                            history:
                              type: array
                              items:
                                type: object
                                properties:
                                  id:
                                    type: string
                                  continue_at:
                                    type: number
                                  type:
                                    type: string
                                  source:
                                    type: string
                                  infill:
                                    type: boolean
                                required:
                                  - id
                                  - continue_at
                                  - type
                                  - source
                                  - infill
                                x-apifox-orders:
                                  - id
                                  - continue_at
                                  - type
                                  - source
                                  - infill
                            concat_history:
                              type: 'null'
                            type:
                              type: string
                            duration:
                              type: 'null'
                            refund_credits:
                              type: 'null'
                            stream:
                              type: boolean
                            infill:
                              type: boolean
                            has_vocal:
                              type: boolean
                            is_audio_upload_tos_accepted:
                              type: boolean
                            error_type:
                              type: 'null'
                            error_message:
                              type: 'null'
                          required:
                            - tags
                            - prompt
                            - gpt_description_prompt
                            - audio_prompt_id
                            - history
                            - concat_history
                            - type
                            - duration
                            - refund_credits
                            - stream
                            - infill
                            - has_vocal
                            - is_audio_upload_tos_accepted
                            - error_type
                            - error_message
                          x-apifox-orders:
                            - tags
                            - prompt
                            - gpt_description_prompt
                            - audio_prompt_id
                            - history
                            - concat_history
                            - type
                            - duration
                            - refund_credits
                            - stream
                            - infill
                            - has_vocal
                            - is_audio_upload_tos_accepted
                            - error_type
                            - error_message
                        is_liked:
                          type: boolean
                        user_id:
                          type: string
                        display_name:
                          type: string
                        handle:
                          type: string
                        is_handle_updated:
                          type: boolean
                        avatar_image_url:
                          type: string
                        is_trashed:
                          type: boolean
                        reaction:
                          type: 'null'
                        created_at:
                          type: string
                        status:
                          type: string
                        title:
                          type: string
                        play_count:
                          type: integer
                        upvote_count:
                          type: integer
                        is_public:
                          type: boolean
                      required:
                        - id
                        - video_url
                        - audio_url
                        - image_url
                        - image_large_url
                        - is_video_pending
                        - major_model_version
                        - model_name
                        - metadata
                        - is_liked
                        - user_id
                        - display_name
                        - handle
                        - is_handle_updated
                        - avatar_image_url
                        - is_trashed
                        - reaction
                        - created_at
                        - status
                        - title
                        - play_count
                        - upvote_count
                        - is_public
                      x-apifox-orders:
                        - id
                        - video_url
                        - audio_url
                        - image_url
                        - image_large_url
                        - is_video_pending
                        - major_model_version
                        - model_name
                        - metadata
                        - is_liked
                        - user_id
                        - display_name
                        - handle
                        - is_handle_updated
                        - avatar_image_url
                        - is_trashed
                        - reaction
                        - created_at
                        - status
                        - title
                        - play_count
                        - upvote_count
                        - is_public
                  metadata:
                    type: object
                    properties:
                      tags:
                        type: string
                      prompt:
                        type: string
                      gpt_description_prompt:
                        type: 'null'
                      audio_prompt_id:
                        type: string
                      history:
                        type: array
                        items:
                          type: object
                          properties:
                            id:
                              type: string
                            continue_at:
                              type: number
                            type:
                              type: string
                            source:
                              type: string
                            infill:
                              type: boolean
                          x-apifox-orders:
                            - id
                            - continue_at
                            - type
                            - source
                            - infill
                      concat_history:
                        type: 'null'
                      type:
                        type: string
                      duration:
                        type: 'null'
                      refund_credits:
                        type: 'null'
                      stream:
                        type: boolean
                      infill:
                        type: boolean
                      has_vocal:
                        type: boolean
                      is_audio_upload_tos_accepted:
                        type: boolean
                      error_type:
                        type: 'null'
                      error_message:
                        type: 'null'
                    required:
                      - tags
                      - prompt
                      - gpt_description_prompt
                      - audio_prompt_id
                      - history
                      - concat_history
                      - type
                      - duration
                      - refund_credits
                      - stream
                      - infill
                      - has_vocal
                      - is_audio_upload_tos_accepted
                      - error_type
                      - error_message
                    x-apifox-orders:
                      - tags
                      - prompt
                      - gpt_description_prompt
                      - audio_prompt_id
                      - history
                      - concat_history
                      - type
                      - duration
                      - refund_credits
                      - stream
                      - infill
                      - has_vocal
                      - is_audio_upload_tos_accepted
                      - error_type
                      - error_message
                  major_model_version:
                    type: string
                  status:
                    type: string
                  created_at:
                    type: string
                  batch_size:
                    type: integer
                required:
                  - id
                  - clips
                  - metadata
                  - major_model_version
                  - status
                  - created_at
                  - batch_size
                x-apifox-orders:
                  - id
                  - clips
                  - metadata
                  - major_model_version
                  - status
                  - created_at
                  - batch_size
              example:
                id: 3d5f0ee4-1d7b-410a-bafd-60a3978284d1
                clips:
                  - id: 7070ec00-462e-42ac-9b9f-1074977f473f
                    video_url: ''
                    audio_url: ''
                    image_url: null
                    image_large_url: null
                    is_video_pending: false
                    major_model_version: v3
                    model_name: chirp-v3
                    metadata:
                      tags: heavy metal
                      prompt: |-
                        [Verse]
                        Stars they shine above me
                        Moonlight softly glows
                        Whispers in the night sky
                        Dreams that only grow

                        [Verse 2]
                        Midnight winds are calling
                        Carrying a tune
                        Heartbeats echo softly
                        Dancing with the moon

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way

                        [Verse 3]
                        Shadows move and twinkle
                        Nighttime come alive
                        Mystery in the heavens
                        Stories that survive

                        [Bridge]
                        Magic fills the darkness
                        Wonder in the air
                        Every star a secret
                        In the sky I stare

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way
                      gpt_description_prompt: null
                      audio_prompt_id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                      history:
                        - id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                          continue_at: 48.762
                          type: upload
                          source: web
                          infill: false
                      concat_history: null
                      type: gen
                      duration: null
                      refund_credits: null
                      stream: true
                      infill: false
                      has_vocal: true
                      is_audio_upload_tos_accepted: true
                      error_type: null
                      error_message: null
                    is_liked: false
                    user_id: 4ed4f182-0b5a-4cde-bffe-44fb5237a3aa
                    display_name: AmbientLens971
                    handle: ambientlens971
                    is_handle_updated: false
                    avatar_image_url: https://cdn1.suno.ai/defaultOrange.jpg
                    is_trashed: false
                    reaction: null
                    created_at: '2024-07-22T07:56:36.710Z'
                    status: submitted
                    title: 'Starry '
                    play_count: 0
                    upvote_count: 0
                    is_public: false
                  - id: 00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90
                    video_url: ''
                    audio_url: ''
                    image_url: null
                    image_large_url: null
                    is_video_pending: false
                    major_model_version: v3
                    model_name: chirp-v3
                    metadata:
                      tags: heavy metal
                      prompt: |-
                        [Verse]
                        Stars they shine above me
                        Moonlight softly glows
                        Whispers in the night sky
                        Dreams that only grow

                        [Verse 2]
                        Midnight winds are calling
                        Carrying a tune
                        Heartbeats echo softly
                        Dancing with the moon

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way

                        [Verse 3]
                        Shadows move and twinkle
                        Nighttime come alive
                        Mystery in the heavens
                        Stories that survive

                        [Bridge]
                        Magic fills the darkness
                        Wonder in the air
                        Every star a secret
                        In the sky I stare

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way
                      gpt_description_prompt: null
                      audio_prompt_id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                      history:
                        - id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                          continue_at: 48.762
                          type: upload
                          source: web
                          infill: false
                      concat_history: null
                      type: gen
                      duration: null
                      refund_credits: null
                      stream: true
                      infill: false
                      has_vocal: true
                      is_audio_upload_tos_accepted: true
                      error_type: null
                      error_message: null
                    is_liked: false
                    user_id: 4ed4f182-0b5a-4cde-bffe-44fb5237a3aa
                    display_name: AmbientLens971
                    handle: ambientlens971
                    is_handle_updated: false
                    avatar_image_url: https://cdn1.suno.ai/defaultOrange.jpg
                    is_trashed: false
                    reaction: null
                    created_at: '2024-07-22T07:56:36.711Z'
                    status: submitted
                    title: 'Starry '
                    play_count: 0
                    upvote_count: 0
                    is_public: false
                metadata:
                  tags: heavy metal
                  prompt: |-
                    [Verse]
                    Stars they shine above me
                    Moonlight softly glows
                    Whispers in the night sky
                    Dreams that only grow

                    [Verse 2]
                    Midnight winds are calling
                    Carrying a tune
                    Heartbeats echo softly
                    Dancing with the moon

                    [Chorus]
                    Starry night starry night
                    Let your light ignite ignite
                    Bright as day bright as day
                    Guide my way guide my way

                    [Verse 3]
                    Shadows move and twinkle
                    Nighttime come alive
                    Mystery in the heavens
                    Stories that survive

                    [Bridge]
                    Magic fills the darkness
                    Wonder in the air
                    Every star a secret
                    In the sky I stare

                    [Chorus]
                    Starry night starry night
                    Let your light ignite ignite
                    Bright as day bright as day
                    Guide my way guide my way
                  gpt_description_prompt: null
                  audio_prompt_id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                  history:
                    - id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                      continue_at: 48.762
                      type: upload
                      source: web
                      infill: false
                  concat_history: null
                  type: gen
                  duration: null
                  refund_credits: null
                  stream: true
                  infill: false
                  has_vocal: true
                  is_audio_upload_tos_accepted: true
                  error_type: null
                  error_message: null
                major_model_version: v3
                status: complete
                created_at: '2024-07-22T07:56:36.699Z'
                batch_size: 1
          headers: {}
          x-apifox-name: 成功
      security:
        - bearer: []
      x-apifox-folder: 音乐生成/suno/suno官网原生格式/所有接口
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7040782/apis/api-343646958-run
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

# 查询任务(feed)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /v1/suno/feed:
    get:
      summary: 查询任务(feed)
      deprecated: false
      description: ''
      tags:
        - 音乐生成/suno/suno官网原生格式/所有接口
      parameters:
        - name: ids
          in: query
          description: 任务 id，多个用英文逗号分割 `,`
          required: false
          example: >-
            00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90,7070ec00-462e-42ac-9b9f-1074977f473f
          schema:
            type: string
        - name: remove_watermark
          in: query
          description: 是否需要去除水印
          required: false
          example: 'true'
          schema:
            type: boolean
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  clips:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        video_url:
                          type: string
                        audio_url:
                          type: string
                        image_url:
                          type: string
                        image_large_url:
                          type: string
                        is_video_pending:
                          type: boolean
                        major_model_version:
                          type: string
                        model_name:
                          type: string
                        metadata:
                          type: object
                          properties:
                            tags:
                              type: string
                            prompt:
                              type: string
                            gpt_description_prompt:
                              type: 'null'
                            audio_prompt_id:
                              type: string
                            history:
                              type: array
                              items:
                                type: object
                                properties:
                                  id:
                                    type: string
                                  type:
                                    type: string
                                  infill:
                                    type: boolean
                                  source:
                                    type: string
                                  continue_at:
                                    type: number
                                required:
                                  - id
                                  - type
                                  - infill
                                  - source
                                  - continue_at
                                x-apifox-orders:
                                  - id
                                  - type
                                  - infill
                                  - source
                                  - continue_at
                            concat_history:
                              type: 'null'
                            type:
                              type: string
                            duration:
                              type: integer
                            refund_credits:
                              type: boolean
                            stream:
                              type: boolean
                            infill:
                              type: boolean
                            has_vocal:
                              type: boolean
                            is_audio_upload_tos_accepted:
                              type: boolean
                            error_type:
                              type: 'null'
                            error_message:
                              type: 'null'
                          required:
                            - tags
                            - prompt
                            - gpt_description_prompt
                            - audio_prompt_id
                            - history
                            - concat_history
                            - type
                            - duration
                            - refund_credits
                            - stream
                            - infill
                            - has_vocal
                            - is_audio_upload_tos_accepted
                            - error_type
                            - error_message
                          x-apifox-orders:
                            - tags
                            - prompt
                            - gpt_description_prompt
                            - audio_prompt_id
                            - history
                            - concat_history
                            - type
                            - duration
                            - refund_credits
                            - stream
                            - infill
                            - has_vocal
                            - is_audio_upload_tos_accepted
                            - error_type
                            - error_message
                        is_liked:
                          type: boolean
                        user_id:
                          type: string
                        display_name:
                          type: string
                        handle:
                          type: string
                        is_handle_updated:
                          type: boolean
                        avatar_image_url:
                          type: string
                        is_trashed:
                          type: boolean
                        reaction:
                          type: 'null'
                        created_at:
                          type: string
                        status:
                          type: string
                        title:
                          type: string
                        play_count:
                          type: integer
                        upvote_count:
                          type: integer
                        is_public:
                          type: boolean
                      required:
                        - id
                        - video_url
                        - audio_url
                        - image_url
                        - image_large_url
                        - is_video_pending
                        - major_model_version
                        - model_name
                        - metadata
                        - is_liked
                        - user_id
                        - display_name
                        - handle
                        - is_handle_updated
                        - avatar_image_url
                        - is_trashed
                        - reaction
                        - created_at
                        - status
                        - title
                        - play_count
                        - upvote_count
                        - is_public
                      x-apifox-orders:
                        - id
                        - video_url
                        - audio_url
                        - image_url
                        - image_large_url
                        - is_video_pending
                        - major_model_version
                        - model_name
                        - metadata
                        - is_liked
                        - user_id
                        - display_name
                        - handle
                        - is_handle_updated
                        - avatar_image_url
                        - is_trashed
                        - reaction
                        - created_at
                        - status
                        - title
                        - play_count
                        - upvote_count
                        - is_public
                  num_total_results:
                    type: integer
                  current_page:
                    type: integer
                required:
                  - clips
                  - num_total_results
                  - current_page
                x-apifox-orders:
                  - clips
                  - num_total_results
                  - current_page
              example:
                clips:
                  - id: 00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90
                    video_url: >-
                      https://cdn1.suno.ai/00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90.mp4
                    audio_url: >-
                      https://cdn1.suno.ai/00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90.mp3
                    image_url: >-
                      https://cdn2.suno.ai/image_00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90.jpeg
                    image_large_url: >-
                      https://cdn2.suno.ai/image_large_00e6b9e4-c29c-4cfe-8d7a-5b3f06ff5b90.jpeg
                    is_video_pending: false
                    major_model_version: v3.5
                    model_name: chirp-v3
                    metadata:
                      tags: heavy metal
                      prompt: |-
                        [Verse]
                        Stars they shine above me
                        Moonlight softly glows
                        Whispers in the night sky
                        Dreams that only grow

                        [Verse 2]
                        Midnight winds are calling
                        Carrying a tune
                        Heartbeats echo softly
                        Dancing with the moon

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way

                        [Verse 3]
                        Shadows move and twinkle
                        Nighttime come alive
                        Mystery in the heavens
                        Stories that survive

                        [Bridge]
                        Magic fills the darkness
                        Wonder in the air
                        Every star a secret
                        In the sky I stare

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way
                      gpt_description_prompt: null
                      audio_prompt_id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                      history:
                        - id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                          type: upload
                          infill: false
                          source: web
                          continue_at: 48.762
                      concat_history: null
                      type: gen
                      duration: 191
                      refund_credits: false
                      stream: true
                      infill: false
                      has_vocal: true
                      is_audio_upload_tos_accepted: true
                      error_type: null
                      error_message: null
                    is_liked: false
                    user_id: 4ed4f182-0b5a-4cde-bffe-44fb5237a3aa
                    display_name: AmbientLens971
                    handle: ambientlens971
                    is_handle_updated: false
                    avatar_image_url: https://cdn1.suno.ai/defaultOrange.jpg
                    is_trashed: false
                    reaction: null
                    created_at: '2024-07-22T07:56:36.711Z'
                    status: complete
                    title: 'Starry '
                    play_count: 0
                    upvote_count: 0
                    is_public: false
                  - id: 7070ec00-462e-42ac-9b9f-1074977f473f
                    video_url: >-
                      https://cdn1.suno.ai/7070ec00-462e-42ac-9b9f-1074977f473f.mp4
                    audio_url: >-
                      https://cdn1.suno.ai/7070ec00-462e-42ac-9b9f-1074977f473f.mp3
                    image_url: >-
                      https://cdn2.suno.ai/image_7070ec00-462e-42ac-9b9f-1074977f473f.jpeg
                    image_large_url: >-
                      https://cdn2.suno.ai/image_large_7070ec00-462e-42ac-9b9f-1074977f473f.jpeg
                    is_video_pending: false
                    major_model_version: v3.5
                    model_name: chirp-v3
                    metadata:
                      tags: heavy metal
                      prompt: |-
                        [Verse]
                        Stars they shine above me
                        Moonlight softly glows
                        Whispers in the night sky
                        Dreams that only grow

                        [Verse 2]
                        Midnight winds are calling
                        Carrying a tune
                        Heartbeats echo softly
                        Dancing with the moon

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way

                        [Verse 3]
                        Shadows move and twinkle
                        Nighttime come alive
                        Mystery in the heavens
                        Stories that survive

                        [Bridge]
                        Magic fills the darkness
                        Wonder in the air
                        Every star a secret
                        In the sky I stare

                        [Chorus]
                        Starry night starry night
                        Let your light ignite ignite
                        Bright as day bright as day
                        Guide my way guide my way
                      gpt_description_prompt: null
                      audio_prompt_id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                      history:
                        - id: m_2e584f32-7ae3-4b2d-93f6-391f65a01f15
                          type: upload
                          infill: false
                          source: web
                          continue_at: 48.762
                      concat_history: null
                      type: gen
                      duration: 150.56
                      refund_credits: false
                      stream: true
                      infill: false
                      has_vocal: true
                      is_audio_upload_tos_accepted: true
                      error_type: null
                      error_message: null
                    is_liked: false
                    user_id: 4ed4f182-0b5a-4cde-bffe-44fb5237a3aa
                    display_name: AmbientLens971
                    handle: ambientlens971
                    is_handle_updated: false
                    avatar_image_url: https://cdn1.suno.ai/defaultOrange.jpg
                    is_trashed: false
                    reaction: null
                    created_at: '2024-07-22T07:56:36.710Z'
                    status: complete
                    title: 'Starry '
                    play_count: 0
                    upvote_count: 0
                    is_public: false
                num_total_results: 2
                current_page: 0
          headers: {}
          x-apifox-name: 成功
      security:
        - bearer: []
      x-apifox-folder: 音乐生成/suno/suno官网原生格式/所有接口
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/7040782/apis/api-343646960-run
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
