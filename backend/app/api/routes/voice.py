"""Voice chat routes using LiveKit."""
import time
import socket
import jwt
import base64
import httpx
import json
import asyncio
import tempfile
import os
import queue as _queue
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

# Force IPv4 for DashScope WebSocket: IPv6 often times out on some networks
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_prefer_getaddrinfo(*args, **kwargs):
    results = _orig_getaddrinfo(*args, **kwargs)
    ipv4 = [r for r in results if r[0] == socket.AF_INET]
    return ipv4 if ipv4 else results
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.db.session import get_db
from app.models.campaign import Campaign, CampaignMember
from app.models.chat_message import ChatMessage
from app.models.ai_settings import ModelType
from app.core.config import settings
from app.core.security import require_auth
from app.api.routes.ai_settings import get_model_config, _get_usage_model_type
from app.services.realtime_publisher import realtime_publisher
from app.domain.parsing.oss_storage import get_oss_storage

router = APIRouter(prefix="/api/voice", tags=["voice"])


class VoiceTokenResponse(BaseModel):
    token: str
    url: str
    room_name: str


def generate_livekit_token(
    room_name: str,
    participant_identity: str,
    participant_name: str,
) -> str:
    """Generate a LiveKit access token."""
    # Token valid for 24 hours
    exp = int(time.time()) + 86400

    # LiveKit JWT claims
    claims = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": participant_identity,
        "name": participant_name,
        "exp": exp,
        "nbf": int(time.time()),
        "video": {
            "roomJoin": True,
            "room": room_name,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }

    return jwt.encode(claims, settings.LIVEKIT_API_SECRET, algorithm="HS256")


@router.post("/token/{campaign_id}", response_model=VoiceTokenResponse)
async def get_voice_token(
    campaign_id: int,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get LiveKit token for joining voice chat in a campaign."""
    user_id = current_user.get("user_id")
    display_name = current_user.get("display_name", "Unknown")

    # Verify campaign exists
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Check if user is DM or member
    is_dm = campaign.dm_user_id == user_id
    if not is_dm:
        result = await db.execute(
            select(CampaignMember).where(
                CampaignMember.campaign_id == campaign_id,
                CampaignMember.user_id == user_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this campaign")

    # Generate token
    room_name = f"campaign_{campaign_id}"
    token = generate_livekit_token(
        room_name=room_name,
        participant_identity=user_id,
        participant_name=display_name,
    )

    return VoiceTokenResponse(
        token=token,
        url=settings.LIVEKIT_URL,
        room_name=room_name,
    )


class TranscribeRequest(BaseModel):
    """Speech-to-text request"""
    audio_base64: str  # Base64 encoded audio data
    format: str = "webm"  # Audio format: webm, wav, mp3, etc.
    language: Optional[str] = "zh"  # Language hint


class TranscribeResponse(BaseModel):
    """Speech-to-text response"""
    text: str


async def _convert_audio_to_wav(audio_data: bytes, input_format: str) -> bytes:
    """Convert audio to WAV format using ffmpeg (async, non-blocking)."""
    with tempfile.NamedTemporaryFile(suffix=f'.{input_format}', delete=False) as in_file:
        in_file.write(audio_data)
        in_path = in_file.name

    out_path = in_path.rsplit('.', 1)[0] + '.wav'

    try:
        proc = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-i', in_path,
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',       # mono
            '-f', 'wav',
            out_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise Exception("Audio conversion timed out")

        if proc.returncode != 0:
            print(f"[Voice] ffmpeg error: {stderr.decode()[:200]}")
            raise Exception("Audio conversion failed")

        with open(out_path, 'rb') as f:
            return f.read()
    finally:
        if os.path.exists(in_path):
            os.unlink(in_path)
        if os.path.exists(out_path):
            os.unlink(out_path)


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    request: TranscribeRequest,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Transcribe audio to text.

    Supports two modes based on configured model type:
    - STT: Uses Whisper-compatible API (audio/transcriptions)
    - CHAT/others: Uses multimodal chat API with input_audio

    Accepts base64 encoded audio and returns transcribed text.
    """
    # Get the model type configured for voice_to_text
    model_type = await _get_usage_model_type(db, "voice_to_text")

    try:
        config = await get_model_config(db, model_type)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(
                status_code=400,
                detail=f"语音转文字使用的 {model_type.value} 模型未配置。请在 API 设置页面配置。"
            )
        raise

    # Determine audio format
    file_ext = request.format.lower()
    format_map = {
        "webm": "webm", "wav": "wav", "mp3": "mp3",
        "m4a": "m4a", "ogg": "ogg", "mp4": "mp4",
    }
    audio_format = format_map.get(file_ext, file_ext)

    # Check if using Dashscope API (needs special handling)
    api_url_lower = (config.api_url or "").lower()
    is_dashscope = "dashscope" in api_url_lower or "aliyuncs.com" in api_url_lower

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            # Dashscope uses chat completions format even for ASR models
            if is_dashscope:
                print(f"[Voice] Using Dashscope API: {config.model_name} @ {config.api_url}")
                print(f"[Voice] Audio format: {audio_format}, base64 length: {len(request.audio_base64)}")
                return await _transcribe_multimodal(client, config, request.audio_base64, audio_format)
            # If using STT model type with non-Dashscope, use Whisper API format
            elif model_type == ModelType.STT:
                return await _transcribe_whisper(client, config, request.audio_base64, audio_format, request.language)
            else:
                # Try multimodal chat API
                print(f"[Voice] Using multimodal API: {config.model_name} @ {config.api_url}")
                print(f"[Voice] Audio format: {audio_format}, base64 length: {len(request.audio_base64)}")
                return await _transcribe_multimodal(client, config, request.audio_base64, audio_format)

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="语音识别超时")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"请求语音识别服务失败: {str(e)}")


async def _transcribe_whisper(
    client: httpx.AsyncClient,
    config,
    audio_base64: str,
    audio_format: str,
    language: str | None
) -> TranscribeResponse:
    """Use Whisper-compatible API (audio/transcriptions)"""
    # Decode base64 audio
    try:
        audio_data = base64.b64decode(audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio data")

    # Determine MIME type
    mime_map = {
        "webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg",
        "m4a": "audio/m4a", "ogg": "audio/ogg", "mp4": "audio/mp4",
    }
    mime_type = mime_map.get(audio_format, f"audio/{audio_format}")

    # Build Whisper API URL
    api_url = config.api_url.rstrip("/")
    if not api_url.endswith("/transcriptions"):
        api_url = f"{api_url}/audio/transcriptions"

    # Prepare multipart form data
    files = {"file": (f"audio.{audio_format}", audio_data, mime_type)}
    data = {"model": config.model_name}
    if language:
        data["language"] = language

    headers = {"Authorization": f"Bearer {config.api_key}"}

    response = await client.post(api_url, files=files, data=data, headers=headers)

    if response.status_code != 200:
        error_detail = response.text
        print(f"[STT Whisper] Error: {response.status_code} - {error_detail}")
        raise HTTPException(status_code=500, detail=f"语音识别失败: {error_detail[:200]}")

    result = response.json()
    text = result.get("text", "") if isinstance(result, dict) else str(result)
    return TranscribeResponse(text=text.strip())


async def _transcribe_multimodal(
    client: httpx.AsyncClient,
    config,
    audio_base64: str,
    audio_format: str
) -> TranscribeResponse:
    """Use multimodal chat API with audio input.

    Supports different formats:
    - Dashscope (Qwen): Uses audio content type
    - Gemini/Others: Uses image_url with data URL (converted to WAV)
    """
    # Decode base64 audio
    try:
        audio_data = base64.b64decode(audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio data")

    api_url = config.api_url.lower() if config.api_url else ""
    is_dashscope = "dashscope" in api_url or "aliyuncs.com" in api_url

    if is_dashscope:
        # Dashscope/Qwen ASR format
        print(f"[Voice] Using Dashscope/Qwen format for {config.model_name}")
        mime_type = f"audio/{audio_format}"
        data_url = f"data:{mime_type};base64,{audio_base64}"

        # Add D&D context to help with recognition
        dnd_context = "这是龙与地下城(D&D)桌游的对话。常见术语：诗人、吟游诗人、法师、术士、牧师、圣骑士、战士、游侠、盗贼、武僧、野蛮人、德鲁伊、邪术师、奇械师、血猎人。"

        messages = [
            {
                "role": "system",
                "content": [
                    {"type": "text", "text": dnd_context}
                ]
            },
            {
                "role": "user",
                "content": [
                    {"type": "audio", "audio": data_url}
                ]
            }
        ]
    else:
        # For Gemini and others, convert to WAV and use image_url format
        if audio_format != "wav":
            try:
                print(f"[Voice] Converting {audio_format} to wav...")
                audio_data = await _convert_audio_to_wav(audio_data, audio_format)
                audio_format = "wav"
                audio_base64 = base64.b64encode(audio_data).decode('utf-8')
                print(f"[Voice] Conversion done, new size: {len(audio_data)} bytes")
            except Exception as e:
                print(f"[Voice] Conversion failed: {e}, using original format")

        mime_type = "audio/wav" if audio_format == "wav" else f"audio/{audio_format}"

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{audio_base64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": "这是一段中文语音，请精确转录为文字。要求：1）逐字转录，不要改变或省略任何词；2）注意区分同音字，根据上下文选择正确的字；3）只输出转录结果，不要添加标点或其他内容。"
                    }
                ]
            }
        ]

    api_url = config.api_url.rstrip("/")
    if not api_url.endswith("/chat/completions"):
        api_url = f"{api_url}/chat/completions"

    payload = {
        "model": config.model_name,
        "messages": messages,
        "max_tokens": 1000,
    }

    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }

    response = await client.post(api_url, json=payload, headers=headers)

    if response.status_code != 200:
        error_detail = response.text
        print(f"[STT Multimodal] Error: {response.status_code} - {error_detail}")
        raise HTTPException(status_code=500, detail=f"语音识别失败: {error_detail[:200]}")

    result = response.json()

    # Extract text from chat completion response
    text = ""
    if "choices" in result and len(result["choices"]) > 0:
        choice = result["choices"][0]
        if "message" in choice:
            content = choice["message"].get("content", "")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text = item.get("text", "")
                        break
                    elif isinstance(item, str):
                        text = item
                        break

    return TranscribeResponse(text=text.strip())


# ============= Text-to-Speech (TTS) =============

# Default clone voices
QWEN_VC_DEFAULT_VOICE = "qwen-tts-vc-dwnpc60s-voice-20260202170345613-c5c0"
COSYVOICE_DEFAULT_VOICE = "cosyvoice-v3-flash-dwnpc-909a965de2304e34b5ab916d71d6d79d"

# Built-in system voices for qwen3-tts / qwen3-tts-flash
QWEN3_TTS_SYSTEM_VOICES = [
    {"id": "Cherry", "name": "Cherry / 千悦", "gender": "female", "desc": "阳光少女，默认音色"},
    {"id": "Ethan", "name": "Ethan / 尘旭", "gender": "male", "desc": "标准男声主播"},
    {"id": "Chelsie", "name": "Chelsie", "gender": "female", "desc": "温柔女声"},
    {"id": "Elias", "name": "Elias / 莫僵尸", "gender": "male", "desc": "学术风格"},
    {"id": "Jada", "name": "Jada / 上海阿珍", "gender": "female", "desc": "上海方言"},
    {"id": "Dylan", "name": "Dylan / 北京小东", "gender": "male", "desc": "北京方言"},
    {"id": "Sunny", "name": "Sunny / 四川清儿", "gender": "female", "desc": "四川方言"},
    {"id": "Nofish", "name": "Nofish", "gender": "male", "desc": "男声"},
    {"id": "Jennifer", "name": "Jennifer", "gender": "female", "desc": "英文女声"},
    {"id": "Ryan", "name": "Ryan", "gender": "male", "desc": "英文男声"},
    {"id": "Katerina", "name": "Katerina", "gender": "female", "desc": "女声"},
    {"id": "Li", "name": "Li", "gender": "female", "desc": "女声"},
    {"id": "Marcus", "name": "Marcus", "gender": "male", "desc": "男声"},
    {"id": "Roy", "name": "Roy", "gender": "male", "desc": "男声"},
    {"id": "Peter", "name": "Peter", "gender": "male", "desc": "男声"},
    {"id": "Rocky", "name": "Rocky", "gender": "male", "desc": "男声"},
    {"id": "Kiki", "name": "Kiki", "gender": "female", "desc": "女声"},
    {"id": "Eric", "name": "Eric", "gender": "male", "desc": "男声"},
]


@router.get("/available-voices")
async def list_available_voices(
    model_name: str = "",
    db: AsyncSession = Depends(get_db),
):
    """List available TTS voices for a given model. If model_name is empty, uses the configured TTS model."""
    if not model_name:
        try:
            model_type = await _get_usage_model_type(db, "text_to_speech")
            config = await get_model_config(db, model_type)
            model_name = config.model_name or ""
        except Exception:
            model_name = ""

    mn = model_name.lower()

    if mn.startswith("qwen3-tts-vc"):
        return {
            "model": model_name,
            "type": "voice_clone",
            "voices": [
                {"id": QWEN_VC_DEFAULT_VOICE, "name": "Deepwood NPC (克隆)", "gender": "male", "desc": "项目默认克隆音色"},
            ],
            "note": "克隆音色模型，使用预训练的音色ID。可在 DashScope 控制台创建新的克隆音色。",
        }

    if mn.startswith("cosyvoice"):
        return {
            "model": model_name,
            "type": "voice_clone",
            "voices": [
                {"id": COSYVOICE_DEFAULT_VOICE, "name": "Deepwood NPC (克隆)", "gender": "male", "desc": "项目默认克隆音色"},
            ],
            "note": "CosyVoice 克隆音色模型。可通过 DashScope SDK 创建新音色。",
        }

    if "qwen" in mn or "tts-flash" in mn or "tts" in mn:
        return {
            "model": model_name,
            "type": "system",
            "voices": QWEN3_TTS_SYSTEM_VOICES,
            "note": "Qwen3-TTS 内置系统音色，无需克隆，合成速度快。",
        }

    # Generic / unknown model
    return {
        "model": model_name,
        "type": "unknown",
        "voices": [],
        "note": "未识别的模型类型，请手动输入音色名称。",
    }


class SynthesizeRequest(BaseModel):
    """Text-to-speech request"""
    text: str
    voice: Optional[str] = None
    language: Optional[str] = "Chinese"
    message_id: Optional[int] = None
    campaign_id: Optional[int] = None
    force_regenerate: bool = False


# Per-message TTS dedup locks
_tts_locks: dict[int, asyncio.Lock] = {}
_tts_locks_guard = asyncio.Lock()


class SynthesizeResponse(BaseModel):
    """Text-to-speech response"""
    audio_url: Optional[str] = None
    audio_base64: Optional[str] = None
    format: str = "wav"


def _synthesize_cosyvoice(api_key: str, model_name: str, voice: str, text: str) -> bytes:
    """Call CosyVoice via DashScope SDK (blocking, uses WebSocket)."""
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer
    dashscope.api_key = api_key
    synthesizer = SpeechSynthesizer(model=model_name, voice=voice)
    audio = synthesizer.call(text)
    if not audio:
        raise Exception("CosyVoice returned empty audio")
    return audio


def _split_text_chunks(text: str, max_len: int = 300) -> list[str]:
    """Split text into chunks at sentence boundaries for TTS."""
    import re
    if len(text) <= max_len:
        return [text]
    # Split at Chinese/English sentence endings
    parts = re.split(r'(?<=[。！？.!?\n])', text)
    chunks = []
    buf = ""
    for p in parts:
        if not p:
            continue
        if len(buf) + len(p) > max_len and buf:
            chunks.append(buf)
            buf = p
        else:
            buf += p
    if buf:
        chunks.append(buf)
    return chunks or [text]


def _synthesize_qwen_vc_realtime_single(
    api_key: str, model_name: str, voice: str, text: str
) -> bytes:
    """Synthesize a single text segment via qwen3-tts-vc-realtime WebSocket.
    Returns raw PCM bytes (no WAV header)."""
    import time
    import logging
    import threading
    import dashscope
    from dashscope.audio.qwen_tts_realtime import (
        QwenTtsRealtime, QwenTtsRealtimeCallback, AudioFormat,
    )

    log = logging.getLogger(__name__)
    dashscope.api_key = api_key

    class _Cb(QwenTtsRealtimeCallback):
        def __init__(self):
            self.done = threading.Event()
            self.audio = bytearray()
            self.error_msg = None
            self.delta_count = 0

        def on_open(self):
            pass

        def on_close(self, code, msg):
            log.info(f"[TTS] on_close: code={code}, audio_bytes={len(self.audio)}, deltas={self.delta_count}")
            self.done.set()

        def on_event(self, resp):
            etype = resp.get("type", "")
            if etype == "response.audio.delta":
                self.audio.extend(base64.b64decode(resp.get("delta", "")))
                self.delta_count += 1

        def on_error(self, resp):
            self.error_msg = str(resp)[:300]
            log.error(f"[TTS] on_error: {self.error_msg}")
            self.done.set()

    cb = _Cb()
    client = QwenTtsRealtime(
        model=model_name, callback=cb,
        url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    )
    client.connect()
    client.update_session(
        voice=voice,
        response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
        mode="server_commit",
    )

    # Send text in small chunks (official example uses ~20 chars per chunk)
    chunks = _split_text_chunks(text, max_len=200)
    for chunk in chunks:
        client.append_text(chunk)
        time.sleep(0.1)  # Match official example delay

    time.sleep(0.2)
    client.finish()
    timeout = max(60, len(text) // 20)
    cb.done.wait(timeout=timeout)

    if cb.error_msg:
        raise Exception(f"qwen3-tts-vc-realtime error: {cb.error_msg}")

    pcm = bytes(cb.audio)
    if not pcm:
        raise Exception("qwen3-tts-vc-realtime returned empty audio")

    return pcm


def _synthesize_qwen_vc_realtime(
    api_key: str, model_name: str, voice: str, text: str
) -> bytes:
    """Call qwen3-tts-vc-realtime via DashScope WebSocket SDK (blocking).
    Returns WAV bytes (PCM wrapped with WAV header).
    For long text, splits into segments and synthesizes each in a separate
    WebSocket session to avoid server_commit mode truncation."""
    import struct
    import logging

    log = logging.getLogger(__name__)

    # Force IPv4 to avoid IPv6 timeout with DashScope WebSocket
    socket.getaddrinfo = _ipv4_prefer_getaddrinfo

    try:
        # Split long text into independent segments for separate synthesis
        # Each segment gets its own WebSocket session to avoid truncation
        segments = _split_text_chunks(text, max_len=500)
        log.info(f"[TTS] text_len={len(text)}, segments={len(segments)}")

        all_pcm = bytearray()
        for i, segment in enumerate(segments):
            log.info(f"[TTS] synthesizing segment {i+1}/{len(segments)}, len={len(segment)}")
            pcm = _synthesize_qwen_vc_realtime_single(
                api_key, model_name, voice, segment
            )
            all_pcm.extend(pcm)
            log.info(f"[TTS] segment {i+1} done, pcm_bytes={len(pcm)}")

        pcm = bytes(all_pcm)
        log.info(f"[TTS] all segments done, total_pcm_bytes={len(pcm)}")

        if not pcm:
            raise Exception("qwen3-tts-vc-realtime returned empty audio")

        # Wrap PCM in WAV header (24kHz, mono, 16-bit)
        wav_header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF", 36 + len(pcm), b"WAVE",
            b"fmt ", 16, 1, 1, 24000, 24000 * 2, 2, 16,
            b"data", len(pcm),
        )
        return wav_header + pcm
    finally:
        socket.getaddrinfo = _orig_getaddrinfo


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize_speech(
    request: SynthesizeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Synthesize speech from text.
    With message_id: checks DB cache, deduplicates concurrent requests, broadcasts via WS.
    Without message_id: direct synthesis (for ModuleScript etc.)
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    # No message_id → direct synthesis, no cache/broadcast
    if not request.message_id:
        return await _do_synthesize(request, db)

    # --- Cached path ---
    msg_id = request.message_id
    campaign_id = request.campaign_id

    # 1. Check DB cache (prefer tts_url, fallback to legacy tts_audio)
    msg = await db.get(ChatMessage, msg_id)
    if msg and not request.force_regenerate:
        meta = msg.meta or {}
        if meta.get("tts_url"):
            return SynthesizeResponse(
                audio_url=meta["tts_url"],
                format=meta.get("tts_format", "wav"),
            )
        if meta.get("tts_audio"):
            return SynthesizeResponse(
                audio_base64=meta["tts_audio"],
                format=meta.get("tts_format", "wav"),
            )

    # 2. Acquire per-message lock (dedup concurrent requests)
    async with _tts_locks_guard:
        if msg_id not in _tts_locks:
            _tts_locks[msg_id] = asyncio.Lock()
        lock = _tts_locks[msg_id]

    async with lock:
        # Double-check after acquiring lock (skip if force_regenerate)
        if msg and not request.force_regenerate:
            await db.refresh(msg)
            meta = msg.meta or {}
            if meta.get("tts_url"):
                return SynthesizeResponse(
                    audio_url=meta["tts_url"],
                    format=meta.get("tts_format", "wav"),
                )
            if meta.get("tts_audio"):
                return SynthesizeResponse(
                    audio_base64=meta["tts_audio"],
                    format=meta.get("tts_format", "wav"),
                )

        # 3. Broadcast tts_generating
        if campaign_id:
            await realtime_publisher.publish_tts_generating(
                campaign_id,
                message_id=msg_id,
            )

        # 4. Synthesize
        result = await _do_synthesize(request, db)

        # 5. Upload to OSS and write cache to DB meta
        oss_url = await _upload_tts_to_oss(result, campaign_id or 0, msg_id)
        if msg:
            meta = dict(msg.meta or {})
            meta["tts_url"] = oss_url
            meta["tts_format"] = result.format
            msg.meta = meta
            await db.commit()

        # 6. Broadcast tts_ready (always use audio_url)
        if campaign_id:
            await realtime_publisher.publish_tts_ready(
                campaign_id,
                message_id=msg_id,
                audio_url=oss_url,
                format=result.format,
            )

    # 7. Cleanup lock
    async with _tts_locks_guard:
        _tts_locks.pop(msg_id, None)

    return SynthesizeResponse(audio_url=oss_url, format=result.format)


def _clean_markdown_for_tts(text: str) -> str:
    """Strip markdown formatting so TTS reads natural text."""
    import re
    # Custom markers: :::writing, ::: etc.
    text = re.sub(r':::\w*', '', text)
    # Horizontal rules
    text = re.sub(r'^-{3,}$', '', text, flags=re.MULTILINE)
    # Headers: ### Title → Title
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Bullet points: - item / * item → item
    text = re.sub(r'^[\s]*[-*+]\s+', '', text, flags=re.MULTILINE)
    # Numbered lists: 1. item → item
    text = re.sub(r'^[\s]*\d+\.\s+', '', text, flags=re.MULTILINE)
    # Bold/italic: **text** / *text* / __text__ / _text_
    text = re.sub(r'\*{1,3}(.*?)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,3}(.*?)_{1,3}', r'\1', text)
    # Inline code: `code`
    text = re.sub(r'`([^`]*)`', r'\1', text)
    # Links: [text](url) → text
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    # Blockquotes: > text → text
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    # Remaining markdown chars that TTS might read literally
    text = re.sub(r'[|~]', '', text)
    # Collapse multiple newlines / spaces
    text = re.sub(r'\n{2,}', '。', text)
    text = re.sub(r'\n', '，', text)
    text = re.sub(r'\s{2,}', ' ', text)
    text = re.sub(r'。{2,}', '。', text)
    return text.strip()


async def _upload_tts_to_oss(
    result: SynthesizeResponse, campaign_id: int, message_id: int
) -> str:
    """Upload TTS audio to OSS, return permanent URL.

    Handles two cases from _do_synthesize:
    - audio_base64: decode and upload
    - audio_url (DashScope temp link): download then upload
    Raises HTTPException on failure.
    """
    import logging
    log = logging.getLogger(__name__)

    audio_data: bytes | None = None
    fmt = result.format or "wav"

    if result.audio_base64:
        audio_data = base64.b64decode(result.audio_base64)
    elif result.audio_url:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(result.audio_url)
                resp.raise_for_status()
                audio_data = resp.content
        except Exception as e:
            log.error(f"[TTS] 下载临时音频失败: {e}")
            raise HTTPException(status_code=500, detail=f"下载临时音频失败: {e}")

    if not audio_data:
        raise HTTPException(status_code=500, detail="TTS 合成无音频数据")

    try:
        oss = get_oss_storage()
        url = await oss.upload_tts_audio_async(
            audio_data, campaign_id, message_id, fmt
        )
    except Exception as e:
        log.error(f"[TTS] OSS上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"TTS音频上传OSS失败: {e}")

    if not url:
        raise HTTPException(status_code=500, detail="TTS音频上传OSS返回空URL")

    return url


async def _do_synthesize(
    request: SynthesizeRequest, db: AsyncSession
) -> SynthesizeResponse:
    """Core TTS synthesis logic (no caching/broadcast)."""
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    model_type = await _get_usage_model_type(db, "text_to_speech")

    try:
        config = await get_model_config(db, model_type)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(
                status_code=400,
                detail=f"TTS 模型（{model_type.value}）未配置。请在 API 设置页面配置。"
            )
        raise

    api_url = (config.api_url or "").rstrip("/")
    api_key = config.api_key
    model_name = config.model_name or "qwen3-tts-vc-realtime-2026-01-15"
    text = _clean_markdown_for_tts(request.text.strip())

    # qwen3-tts-vc-realtime: WebSocket with clone voice
    if model_name.startswith("qwen3-tts-vc"):
        voice = request.voice or QWEN_VC_DEFAULT_VOICE
        try:
            audio_bytes = await asyncio.to_thread(
                _synthesize_qwen_vc_realtime, api_key, model_name, voice, text
            )
            return SynthesizeResponse(
                audio_base64=base64.b64encode(audio_bytes).decode(),
                format="wav",
            )
        except Exception as e:
            print(f"[TTS] qwen-vc-realtime error: text_len={len(text)}, err={e}")
            raise HTTPException(
                status_code=500, detail=f"语音合成失败: {str(e)[:200]}"
            )

    # CosyVoice: DashScope SDK (WebSocket-based)
    if model_name.startswith("cosyvoice"):
        voice = request.voice or COSYVOICE_DEFAULT_VOICE
        try:
            audio_bytes = await asyncio.to_thread(
                _synthesize_cosyvoice, api_key, model_name, voice, text
            )
            return SynthesizeResponse(
                audio_base64=base64.b64encode(audio_bytes).decode(),
                format="mp3",
            )
        except Exception as e:
            print(f"[TTS] CosyVoice error: {e}")
            raise HTTPException(
                status_code=500, detail=f"语音合成失败: {str(e)[:200]}"
            )

    # Qwen3-TTS-Flash or other DashScope models: REST API
    is_dashscope = "dashscope" in api_url.lower() or "aliyuncs.com" in api_url.lower()
    voice = request.voice or "Cherry"

    if is_dashscope:
        tts_url = f"{api_url}/services/aigc/multimodal-generation/generation"
        if "/api/v1" not in tts_url:
            tts_url = f"{api_url}/api/v1/services/aigc/multimodal-generation/generation"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model_name,
            "input": {
                "text": text,
                "voice": voice,
                "language_type": request.language or "Chinese",
            },
        }
    else:
        tts_url = f"{api_url}/audio/speech"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model_name,
            "input": text,
            "voice": voice,
            "response_format": "mp3",
        }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                tts_url, json=payload, headers=headers
            )

            if response.status_code != 200:
                error_detail = response.text[:300]
                print(f"[TTS] Error: {response.status_code} - {error_detail}")
                raise HTTPException(
                    status_code=500,
                    detail=f"语音合成失败: {error_detail[:200]}"
                )

            if is_dashscope:
                result = response.json()
                audio_url = None
                output = result.get("output", {})
                audio_obj = output.get("audio")
                if isinstance(audio_obj, dict):
                    audio_url = audio_obj.get("url")
                elif isinstance(audio_obj, str):
                    audio_url = audio_obj

                if audio_url:
                    return SynthesizeResponse(
                        audio_url=audio_url, format="wav"
                    )

                print(f"[TTS] Unexpected response: {json.dumps(result)[:500]}")
                raise HTTPException(
                    status_code=500, detail="语音合成返回格式异常"
                )
            else:
                audio_bytes = response.content
                return SynthesizeResponse(
                    audio_base64=base64.b64encode(audio_bytes).decode(),
                    format="mp3",
                )

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="语音合成超时")
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=500,
                detail=f"请求语音合成服务失败: {str(e)}"
            )


# ============= Streaming TTS (SSE) =============


def _stream_vc_to_queue(
    api_key: str, model_name: str, voice: str, text: str,
    audio_q: "_queue.Queue[bytes | None | Exception]",
):
    """Run VC WebSocket synthesis in a thread, pushing PCM chunks to queue."""
    import re
    import threading
    import dashscope
    from dashscope.audio.qwen_tts_realtime import (
        QwenTtsRealtime, QwenTtsRealtimeCallback, AudioFormat,
    )

    socket.getaddrinfo = _ipv4_prefer_getaddrinfo
    dashscope.api_key = api_key

    class _Cb(QwenTtsRealtimeCallback):
        def __init__(self):
            self.done = threading.Event()
        def on_open(self):
            pass
        def on_close(self, code, msg):
            self.done.set()
        def on_event(self, resp):
            if resp.get("type") == "response.audio.delta":
                pcm = base64.b64decode(resp.get("delta", ""))
                if pcm:
                    audio_q.put(pcm)
        def on_error(self, resp):
            audio_q.put(Exception(str(resp)[:200]))
            self.done.set()

    try:
        # Split long text into segments (same as _synthesize_qwen_vc_realtime)
        segments = _split_text_chunks(text, max_len=500)
        for segment in segments:
            cb = _Cb()
            client = QwenTtsRealtime(
                model=model_name, callback=cb,
                url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            )
            client.connect()
            client.update_session(
                voice=voice,
                response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
                mode="server_commit",
            )
            chunks = _split_text_chunks(segment, max_len=200)
            for chunk in chunks:
                client.append_text(chunk)
                time.sleep(0.1)
            time.sleep(0.2)
            client.finish()
            cb.done.wait(timeout=max(60, len(segment) // 20))
    except Exception as e:
        audio_q.put(Exception(str(e)[:200]))
    finally:
        audio_q.put(None)  # Signal done


@router.post("/synthesize-stream")
async def synthesize_stream(
    request: SynthesizeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Stream TTS synthesis via SSE. Returns PCM audio chunks for WebSocket models,
    or falls back to a single audio_url event for REST models."""
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    model_type = await _get_usage_model_type(db, "text_to_speech")
    try:
        config = await get_model_config(db, model_type)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(
                status_code=400,
                detail=f"TTS 模型（{model_type.value}）未配置。"
            )
        raise

    model_name = config.model_name or "qwen3-tts-vc-realtime-2026-01-15"
    api_key = config.api_key
    text = _clean_markdown_for_tts(request.text.strip())

    is_ws_model = model_name.startswith("qwen3-tts-vc") or "realtime" in model_name

    if not is_ws_model:
        # REST model: synthesize fully, return as single event
        result = await _do_synthesize(request, db)

        async def _rest_sse():
            if result.audio_url:
                yield f"data: {json.dumps({'type': 'audio_url', 'url': result.audio_url, 'format': result.format})}\n\n"
            elif result.audio_base64:
                yield f"data: {json.dumps({'type': 'audio_complete', 'audio': result.audio_base64, 'format': result.format})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(_rest_sse(), media_type="text/event-stream")

    # WebSocket model: stream PCM chunks via SSE
    if model_name.startswith("qwen3-tts-vc"):
        voice = request.voice or QWEN_VC_DEFAULT_VOICE
    else:
        voice = request.voice or "Cherry"

    audio_q: _queue.Queue[bytes | None | Exception] = _queue.Queue()

    async def _ws_sse():
        loop = asyncio.get_event_loop()
        # Start synthesis in thread pool
        fut = loop.run_in_executor(
            None, _stream_vc_to_queue, api_key, model_name, voice, text, audio_q
        )

        # Emit start event with PCM format info
        yield f"data: {json.dumps({'type': 'start', 'sample_rate': 24000, 'channels': 1, 'bits': 16})}\n\n"

        all_pcm = bytearray()
        while True:
            try:
                item = await asyncio.to_thread(audio_q.get, timeout=120)
            except Exception:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Timeout'})}\n\n"
                break

            if item is None:
                break
            if isinstance(item, Exception):
                yield f"data: {json.dumps({'type': 'error', 'message': str(item)[:200]})}\n\n"
                break

            all_pcm.extend(item)
            yield f"data: {json.dumps({'type': 'audio', 'data': base64.b64encode(item).decode()})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        await fut

    return StreamingResponse(_ws_sse(), media_type="text/event-stream")
