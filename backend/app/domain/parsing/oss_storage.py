"""
阿里云 OSS 存储 - 用于模组图片上传
从 chatlab 项目精简适配
"""
import asyncio
import oss2
import base64
import hashlib
import io
import logging
from datetime import datetime
from typing import Optional, Tuple
from PIL import Image

from app.core.config import settings

logger = logging.getLogger(__name__)

# 图片配置
THUMBNAIL_MAX_WIDTH = 400
THUMBNAIL_QUALITY = 75
WEBP_QUALITY = 85


class OSSStorage:
    """阿里云 OSS 存储"""

    def __init__(self):
        self.access_key_id = settings.OSS_ACCESS_KEY_ID
        self.access_key_secret = settings.OSS_ACCESS_KEY_SECRET
        self.bucket_name = settings.OSS_BUCKET_NAME
        self.endpoint = settings.OSS_ENDPOINT
        self.cdn_domain = settings.OSS_CDN_DOMAIN

        if not all([self.access_key_id, self.access_key_secret, self.bucket_name]):
            raise ValueError("OSS配置缺失，请检查.env文件")

        self.auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        self.bucket = oss2.Bucket(self.auth, self.endpoint, self.bucket_name)

        # 确保CORS配置正确（canvas加载图片需要）
        self._ensure_cors()

    def _ensure_cors(self):
        """确保OSS bucket配置了CORS规则，允许canvas跨域加载图片"""
        try:
            rule = oss2.models.CorsRule(
                allowed_origins=['*'],
                allowed_methods=['GET', 'HEAD'],
                allowed_headers=['*'],
                max_age_seconds=86400
            )
            self.bucket.put_bucket_cors(oss2.models.BucketCors([rule]))
            logger.info("OSS CORS配置成功")
        except oss2.exceptions.AccessDenied:
            logger.warning("无权限配置OSS CORS，请在阿里云控制台手动配置")
        except Exception as e:
            logger.warning(f"OSS CORS配置失败: {e}")

    def get_url(self, object_key: str) -> str:
        """获取文件URL"""
        if self.cdn_domain:
            return f"https://{self.cdn_domain}/{object_key}"
        return f"https://{self.bucket_name}.{self.endpoint}/{object_key}"

    def url_to_key(self, url: str) -> Optional[str]:
        """从CDN/OSS URL反推object_key"""
        if self.cdn_domain and self.cdn_domain in url:
            return url.split(self.cdn_domain + "/", 1)[-1]
        bucket_host = f"{self.bucket_name}.{self.endpoint}"
        if bucket_host in url:
            return url.split(bucket_host + "/", 1)[-1]
        return None

    def delete_object(self, object_key: str) -> bool:
        """删除OSS对象"""
        try:
            self.bucket.delete_object(object_key)
            logger.info(f"OSS对象已删除: {object_key}")
            return True
        except Exception as e:
            logger.error(f"OSS对象删除失败: {e}")
            return False

    async def delete_object_async(self, object_key: str) -> bool:
        """异步删除OSS对象"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.delete_object, object_key)

    def convert_to_webp(self, image_data: bytes) -> Optional[Tuple[bytes, str]]:
        """转换为WebP格式"""
        try:
            img = Image.open(io.BytesIO(image_data))

            # 处理透明度
            if img.mode == 'P':
                img = img.convert('RGBA')
            elif img.mode == 'LA':
                img = img.convert('RGBA')
            elif img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGB')

            output = io.BytesIO()
            img.save(output, format='WEBP', quality=WEBP_QUALITY, method=4)
            webp_data = output.getvalue()

            # 日志压缩率
            original_size = len(image_data)
            webp_size = len(webp_data)
            ratio = (1 - webp_size / original_size) * 100 if original_size > 0 else 0
            logger.info(f"WebP: {original_size/1024:.1f}KB -> {webp_size/1024:.1f}KB ({ratio:.1f}%减少)")

            return (webp_data, 'webp')
        except Exception as e:
            logger.error(f"WebP转换失败: {e}")
            return None

    def create_thumbnail(self, image_data: bytes) -> Optional[Tuple[bytes, str]]:
        """创建缩略图"""
        try:
            img = Image.open(io.BytesIO(image_data))

            if img.mode == 'P':
                img = img.convert('RGBA')
            elif img.mode == 'LA':
                img = img.convert('RGBA')

            # 缩放
            if img.width > THUMBNAIL_MAX_WIDTH:
                ratio = THUMBNAIL_MAX_WIDTH / img.width
                new_height = int(img.height * ratio)
                img = img.resize((THUMBNAIL_MAX_WIDTH, new_height), Image.Resampling.LANCZOS)

            output = io.BytesIO()
            if img.mode == 'RGBA':
                img.save(output, format='WEBP', quality=THUMBNAIL_QUALITY, method=4)
            else:
                img = img.convert('RGB')
                img.save(output, format='WEBP', quality=THUMBNAIL_QUALITY, method=4)

            return (output.getvalue(), 'webp')
        except Exception as e:
            logger.error(f"缩略图创建失败: {e}")
            return None

    def upload_image_with_thumbnail(
        self,
        image_data: bytes,
        module_id: str,
        image_id: str
    ) -> Optional[Tuple[str, str]]:
        """
        上传图片和缩略图

        Args:
            image_data: 图片二进制数据
            module_id: 模组ID
            image_id: 图片ID

        Returns:
            (原图URL, 缩略图URL) 或 None
        """
        try:
            date_path = datetime.now().strftime("%Y/%m/%d")
            data_hash = hashlib.sha256(image_data).hexdigest()[:8]

            # 转WebP
            webp_result = self.convert_to_webp(image_data)
            if webp_result:
                upload_data, _ = webp_result
                content_type = "image/webp"
                ext = "webp"
            else:
                upload_data = image_data
                content_type = "image/png"
                ext = "png"

            # 原图路径
            filename = f"{image_id}_{data_hash}.{ext}"
            object_key = f"dnd-modules/{module_id}/images/{date_path}/{filename}"

            # 上传原图
            result = self.bucket.put_object(
                object_key,
                upload_data,
                headers={
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=31536000",
                }
            )
            if result.status != 200:
                logger.error(f"OSS上传失败: {result.status}")
                return None

            original_url = self.get_url(object_key)

            # 上传缩略图
            thumbnail_url = None
            thumb_result = self.create_thumbnail(image_data)
            if thumb_result:
                thumb_data, thumb_ext = thumb_result
                thumb_filename = f"{image_id}_{data_hash}_thumb.{thumb_ext}"
                thumb_key = f"dnd-modules/{module_id}/thumbnails/{date_path}/{thumb_filename}"

                thumb_upload = self.bucket.put_object(
                    thumb_key,
                    thumb_data,
                    headers={
                        "Content-Type": "image/webp",
                        "Cache-Control": "public, max-age=31536000",
                    }
                )
                if thumb_upload.status == 200:
                    thumbnail_url = self.get_url(thumb_key)

            logger.info(f"图片上传成功: {original_url}")
            return (original_url, thumbnail_url or original_url)

        except Exception as e:
            logger.error(f"图片上传失败: {e}")
            return None

    def upload_base64_image(
        self,
        base64_data: str,
        module_id: str,
        image_id: str
    ) -> Optional[Tuple[str, str]]:
        """
        上传base64图片

        Args:
            base64_data: base64编码的图片 (data:image/png;base64,...)
            module_id: 模组ID
            image_id: 图片ID

        Returns:
            (原图URL, 缩略图URL) 或 None
        """
        try:
            # 解析base64
            if base64_data.startswith("data:image/"):
                _, encoded = base64_data.split(",", 1)
            else:
                encoded = base64_data

            image_data = base64.b64decode(encoded)
            return self.upload_image_with_thumbnail(image_data, module_id, image_id)
        except Exception as e:
            logger.error(f"Base64图片上传失败: {e}")
            return None

    def upload_avatar(
        self,
        image_data: bytes,
        entity_type: str,
        entity_id: int,
        name: str = ""
    ) -> Optional[Tuple[str, str]]:
        """
        上传头像，生成两个尺寸：128x128(小图)和512x512(大图)

        Args:
            image_data: 图片二进制数据
            entity_type: 实体类型 (monster/item/shop/character)
            entity_id: 实体ID
            name: 实体名称（用于文件名）

        Returns:
            (小图URL, 大图URL) 或 None
        """
        try:
            img = Image.open(io.BytesIO(image_data))
            if img.mode == 'P':
                img = img.convert('RGBA')
            elif img.mode == 'LA':
                img = img.convert('RGBA')
            elif img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGB')

            # Center-crop to 1:1 before resizing to avoid stretch distortion
            w, h = img.size
            if w != h:
                side = min(w, h)
                left = (w - side) // 2
                top = (h - side) // 2
                img = img.crop((left, top, left + side, top + side))

            date_path = datetime.now().strftime("%Y/%m/%d")
            data_hash = hashlib.sha256(image_data).hexdigest()[:8]
            # 只用 ID 和 hash，不用中文名避免编码问题
            prefix = f"{entity_type}_{entity_id}"

            # 生成小图 128x128
            img_small = img.copy()
            img_small = img_small.resize((128, 128), Image.Resampling.LANCZOS)
            small_buffer = io.BytesIO()
            img_small.save(small_buffer, format='WEBP', quality=WEBP_QUALITY, method=4)
            small_data = small_buffer.getvalue()

            small_key = f"dnd-avatars/{entity_type}/{date_path}/{prefix}_{data_hash}_128.webp"
            result = self.bucket.put_object(
                small_key, small_data,
                headers={"Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000"}
            )
            if result.status != 200:
                logger.error(f"OSS上传小图失败: {result.status}")
                return None
            small_url = self.get_url(small_key)

            # 生成大图 512x512
            img_large = img.copy()
            img_large = img_large.resize((512, 512), Image.Resampling.LANCZOS)
            large_buffer = io.BytesIO()
            img_large.save(large_buffer, format='WEBP', quality=WEBP_QUALITY, method=4)
            large_data = large_buffer.getvalue()

            large_key = f"dnd-avatars/{entity_type}/{date_path}/{prefix}_{data_hash}_512.webp"
            result = self.bucket.put_object(
                large_key, large_data,
                headers={"Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000"}
            )
            if result.status != 200:
                logger.error(f"OSS上传大图失败: {result.status}")
                return None
            large_url = self.get_url(large_key)

            logger.info(f"头像上传成功: {small_url}, {large_url}")
            return (small_url, large_url)

        except Exception as e:
            logger.error(f"头像上传失败: {e}")
            return None

    def upload_avatar_base64(
        self,
        base64_data: str,
        entity_type: str,
        entity_id: int,
        name: str = ""
    ) -> Optional[Tuple[str, str]]:
        """上传base64头像"""
        try:
            if base64_data.startswith("data:image/"):
                _, encoded = base64_data.split(",", 1)
            else:
                encoded = base64_data
            image_data = base64.b64decode(encoded)
            return self.upload_avatar(image_data, entity_type, entity_id, name)
        except Exception as e:
            logger.error(f"Base64头像上传失败: {e}")
            return None

    def upload_map_image(
        self,
        image_data: bytes,
        campaign_id: int,
        map_id: str,
        map_name: str = ""
    ) -> Optional[str]:
        """
        上传AI生成的战术地图图片

        Args:
            image_data: 图片二进制数据
            campaign_id: 战役ID
            map_id: 地图唯一标识
            map_name: 地图名称（仅用于日志）

        Returns:
            地图URL 或 None
        """
        try:
            date_path = datetime.now().strftime("%Y/%m/%d")
            data_hash = hashlib.sha256(image_data).hexdigest()[:8]

            # 转WebP格式
            webp_result = self.convert_to_webp(image_data)
            if webp_result:
                upload_data, _ = webp_result
                content_type = "image/webp"
                ext = "webp"
            else:
                upload_data = image_data
                content_type = "image/png"
                ext = "png"

            # 地图路径: maps/{date}/c{campaign_id}_{map_id}_{hash}.webp
            filename = f"c{campaign_id}_{map_id}_{data_hash}.{ext}"
            object_key = f"dnd-maps/{date_path}/{filename}"

            result = self.bucket.put_object(
                object_key,
                upload_data,
                headers={
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=31536000",
                }
            )
            if result.status != 200:
                logger.error(f"OSS上传地图失败: {result.status}")
                return None

            map_url = self.get_url(object_key)
            logger.info(f"地图上传成功: {map_name} -> {map_url}")
            return map_url

        except Exception as e:
            logger.error(f"地图上传失败: {e}")
            return None

    def upload_tts_audio(
        self,
        audio_data: bytes,
        campaign_id: int,
        message_id: int,
        audio_format: str = "wav",
    ) -> Optional[str]:
        """
        上传 TTS 音频到 OSS

        Args:
            audio_data: 音频二进制数据
            campaign_id: 战役ID
            message_id: 消息ID
            audio_format: 音频格式 (wav/mp3)

        Returns:
            音频 URL 或 None
        """
        try:
            date_path = datetime.now().strftime("%Y/%m/%d")
            data_hash = hashlib.sha256(audio_data).hexdigest()[:8]

            ext = audio_format if audio_format in ("wav", "mp3") else "wav"
            content_type = "audio/mpeg" if ext == "mp3" else "audio/wav"

            filename = f"c{campaign_id}_m{message_id}_{data_hash}.{ext}"
            object_key = f"dnd-tts/{date_path}/{filename}"

            result = self.bucket.put_object(
                object_key,
                audio_data,
                headers={
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=31536000",
                },
            )
            if result.status != 200:
                logger.error(f"OSS上传TTS失败: {result.status}")
                return None

            url = self.get_url(object_key)
            logger.info(f"TTS上传成功: {url} ({len(audio_data)} bytes)")
            return url

        except Exception as e:
            logger.error(f"TTS上传失败: {e}")
            return None

    async def upload_tts_audio_async(
        self,
        audio_data: bytes,
        campaign_id: int,
        message_id: int,
        audio_format: str = "wav",
    ) -> Optional[str]:
        """异步上传TTS音频"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_tts_audio,
            audio_data,
            campaign_id,
            message_id,
            audio_format,
        )

    # ============ Async wrappers ============
    # These methods run blocking operations in a thread pool

    async def upload_image_with_thumbnail_async(
        self,
        image_data: bytes,
        module_id: str,
        image_id: str
    ) -> Optional[Tuple[str, str]]:
        """异步上传图片和缩略图"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_image_with_thumbnail,
            image_data,
            module_id,
            image_id
        )

    async def upload_base64_image_async(
        self,
        base64_data: str,
        module_id: str,
        image_id: str
    ) -> Optional[Tuple[str, str]]:
        """异步上传base64图片"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_base64_image,
            base64_data,
            module_id,
            image_id
        )

    async def upload_avatar_async(
        self,
        image_data: bytes,
        entity_type: str,
        entity_id: int,
        name: str = ""
    ) -> Optional[Tuple[str, str]]:
        """异步上传头像"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_avatar,
            image_data,
            entity_type,
            entity_id,
            name
        )

    async def upload_avatar_base64_async(
        self,
        base64_data: str,
        entity_type: str,
        entity_id: int,
        name: str = ""
    ) -> Optional[Tuple[str, str]]:
        """异步上传base64头像"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_avatar_base64,
            base64_data,
            entity_type,
            entity_id,
            name
        )

    async def upload_map_image_async(
        self,
        image_data: bytes,
        campaign_id: int,
        map_id: str,
        map_name: str = ""
    ) -> Optional[str]:
        """异步上传地图图片"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.upload_map_image,
            image_data,
            campaign_id,
            map_id,
            map_name
        )


# 全局实例
_oss_storage: Optional[OSSStorage] = None


def get_oss_storage() -> OSSStorage:
    """获取OSS存储实例"""
    global _oss_storage
    if _oss_storage is None:
        _oss_storage = OSSStorage()
    return _oss_storage
