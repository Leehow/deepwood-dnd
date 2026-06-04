import logging
from typing import Optional, Tuple
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_temporary_avatar_url(url: Optional[str]) -> bool:
    """Detect signed/temp avatar URLs that should not be persisted directly."""
    if not url or not isinstance(url, str):
        return False
    if url.startswith("data:image/"):
        return True

    parsed = urlparse(url)
    if not parsed.scheme:
        return False

    query = parse_qs(parsed.query or "")
    temp_keys = {
        "Expires",
        "OSSAccessKeyId",
        "Signature",
        "x-oss-signature",
        "x-oss-expires",
        "x-oss-credential",
    }
    if any(key in query for key in temp_keys):
        return True

    host = parsed.netloc.lower()
    return "dashscope" in host and "oss-" in host


def is_expired_avatar_url(url: Optional[str]) -> bool:
    """Best-effort expiration check for signed URLs."""
    if not is_temporary_avatar_url(url):
        return False
    parsed = urlparse(url or "")
    query = parse_qs(parsed.query or "")
    expires = query.get("Expires")
    if not expires:
        return False
    try:
        import time
        return int(expires[0]) <= int(time.time())
    except (TypeError, ValueError):
        return False


def is_stable_avatar_url(url: Optional[str]) -> bool:
    """Allow local/static/our-OSS URLs without re-upload."""
    if not url or not isinstance(url, str):
        return False
    if url.startswith(("/assets/", "assets/", "/images/", "images/")):
        return True
    parsed = urlparse(url)
    if not parsed.scheme:
        return False
    if is_temporary_avatar_url(url):
        return False
    host = parsed.netloc.lower()
    bucket_host = f"{settings.OSS_BUCKET_NAME}.{settings.OSS_ENDPOINT}".lower()
    cdn_host = (settings.OSS_CDN_DOMAIN or "").lower()
    return host in {bucket_host, cdn_host} or host.startswith("localhost")


async def materialize_avatar_url(
    image_url: Optional[str],
    entity_type: str,
    entity_id: int,
    name: str = "",
) -> Optional[Tuple[str, str]]:
    """
    Convert a temp/external avatar reference into permanent OSS URLs when possible.
    Returns (small_url, large_url) or None on failure.
    """
    if not image_url:
        return None
    if is_stable_avatar_url(image_url):
        return image_url, image_url

    try:
        from app.domain.parsing.oss_storage import get_oss_storage

        oss = get_oss_storage()
        if image_url.startswith("data:image/"):
            return await oss.upload_avatar_base64_async(image_url, entity_type, entity_id, name)

        parsed = urlparse(image_url)
        if not parsed.scheme:
            return image_url, image_url

        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
            return await oss.upload_avatar_async(resp.content, entity_type, entity_id, name)
    except Exception as exc:
        logger.warning("Failed to materialize avatar URL for %s[%s]: %s", entity_type, entity_id, exc)
        return None
