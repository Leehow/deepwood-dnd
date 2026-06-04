"""
Image storage utilities for saving and managing generated images
Local fallback when OSS is not available
"""
import asyncio
import base64
import uuid
from pathlib import Path
from typing import Optional
from PIL import Image
import io

from app.utils.rules_cache import PROJECT_ROOT

# WebP quality setting (same as OSS storage)
WEBP_QUALITY = 85


def _process_and_save_image_sync(
    image_bytes: bytes,
    image_type: str,
    prefix: str,
    target_size: Optional[tuple[int, int]],
) -> str:
    """Synchronous image processing - to be run in executor."""
    # Process and convert to WebP
    img = Image.open(io.BytesIO(image_bytes))

    # Handle transparency
    if img.mode == 'P':
        img = img.convert('RGBA')
    elif img.mode == 'LA':
        img = img.convert('RGBA')
    elif img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')

    # Resize if target size specified
    if target_size:
        img = img.resize(target_size, Image.Resampling.LANCZOS)

    # Save as WebP
    buffer = io.BytesIO()
    img.save(buffer, format='WEBP', quality=WEBP_QUALITY, method=4)
    processed_bytes = buffer.getvalue()

    # Generate unique filename
    unique_id = str(uuid.uuid4())[:8]
    if prefix:
        filename = f"{prefix}_{unique_id}.webp"
    else:
        filename = f"{unique_id}.webp"

    # Create directory structure: frontend/public/images/{image_type}/
    project_root = PROJECT_ROOT
    images_dir = project_root / "frontend" / "public" / "images" / image_type
    images_dir.mkdir(parents=True, exist_ok=True)

    # Save image file
    file_path = images_dir / filename
    with open(file_path, "wb") as f:
        f.write(processed_bytes)

    # Return URL path (relative to frontend/public/)
    return f"/images/{image_type}/{filename}"


async def save_base64_image_async(
    base64_data: str,
    image_type: str = "avatar",
    prefix: str = "",
    target_size: Optional[tuple[int, int]] = None,
) -> str:
    """
    Save a base64-encoded image to local storage as WebP and return the URL path.
    Async version - runs CPU-intensive operations in thread pool.
    """
    # Clean up base64 data - remove data URI prefix if present
    if "base64," in base64_data:
        base64_data = base64_data.split("base64,")[1]

    # Remove any whitespace or newlines
    base64_data = base64_data.strip().replace("\n", "").replace("\r", "")

    # Decode base64 to bytes
    try:
        image_bytes = base64.b64decode(base64_data)
    except Exception as e:
        raise ValueError(f"Invalid base64 data: {str(e)}")

    # Run CPU-intensive operations in thread pool
    loop = asyncio.get_event_loop()
    try:
        url_path = await loop.run_in_executor(
            None,
            _process_and_save_image_sync,
            image_bytes,
            image_type,
            prefix,
            target_size
        )
        return url_path
    except Exception as e:
        raise ValueError(f"Failed to process image: {str(e)}")


def save_base64_image(
    base64_data: str,
    image_type: str = "avatar",
    prefix: str = "",
    target_size: Optional[tuple[int, int]] = None,
) -> str:
    """
    Synchronous version - for backward compatibility.
    Prefer save_base64_image_async in async contexts.
    """
    # Clean up base64 data - remove data URI prefix if present
    if "base64," in base64_data:
        base64_data = base64_data.split("base64,")[1]

    # Remove any whitespace or newlines
    base64_data = base64_data.strip().replace("\n", "").replace("\r", "")

    # Decode base64 to bytes
    try:
        image_bytes = base64.b64decode(base64_data)
    except Exception as e:
        raise ValueError(f"Invalid base64 data: {str(e)}")

    try:
        return _process_and_save_image_sync(image_bytes, image_type, prefix, target_size)
    except Exception as e:
        raise ValueError(f"Failed to process image: {str(e)}")


def delete_image(url_path: str) -> bool:
    """
    Delete an image file from local storage.

    Args:
        url_path: URL path to the image (e.g., /images/avatars/character_123_abc123.webp)

    Returns:
        True if deleted successfully, False otherwise
    """
    try:
        relative_path = url_path.lstrip("/")
        project_root = PROJECT_ROOT
        file_path = project_root / "frontend" / "public" / relative_path

        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            return True
        return False
    except Exception:
        return False


def get_image_path(url_path: str) -> Optional[Path]:
    """
    Get the file system path for an image URL.

    Args:
        url_path: URL path to the image (e.g., /images/avatars/character_123_abc123.webp)

    Returns:
        Path object if file exists, None otherwise
    """
    try:
        relative_path = url_path.lstrip("/")
        project_root = PROJECT_ROOT
        file_path = project_root / "frontend" / "public" / relative_path

        if file_path.exists() and file_path.is_file():
            return file_path
        return None
    except Exception:
        return None
