#!/usr/bin/env python3
"""
Upload frontend static assets to OSS
- Images: Convert to WebP, upload to OSS
- Music: Upload directly to OSS
- Generate URL mapping JSON for frontend to use
"""

import os
import sys
import json
import hashlib
import io
from pathlib import Path
from datetime import datetime
from PIL import Image
import oss2
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings

# Configuration
FRONTEND_PUBLIC_DIR = Path(__file__).parent.parent.parent / "frontend" / "public"
OUTPUT_MAPPING_FILE = FRONTEND_PUBLIC_DIR / "oss-asset-mapping.json"

WEBP_QUALITY = 85
MAX_WORKERS = 8  # Parallel upload threads

# Asset directories to process
ASSET_DIRS = [
    "assets/spell-icons",
    "assets/equipment-icons",
    "assets/god-icons",
    "assets/skill-icons",
    "assets/condition-icons",
    "assets/ability-icons",
    "assets/monster-avatars",  # Preset monster avatars
    "assets/npc-avatars",  # Preset NPC avatars
    "assets/class-feature-icons",
    "assets/ui",
    "images/classes",
    "images/races",
    "images/monsters",
    "images/avatars",
    "images/shops",
    "images/items",
    "images/action-buttons",
    "images/ui",
    "music",
    "sounds/spells",  # Spell sound effects
    "sounds/attacks",  # Attack sound effects
]

# Root-level files to process
ROOT_FILES = [
    "bg-dragon.jpg",
    "bg-tavern.jpg",
    "logo.jpg",
    "logo.svg",
    "logo.png",
    "favicon.png",
    "favicon-32x32.png",
    "favicon-64x64.png",
    "apple-touch-icon.png",
]

# File extensions to process
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
SVG_EXTENSIONS = {'.svg'}
AUDIO_EXTENSIONS = {'.mp3', '.ogg', '.wav', '.m4a'}


class OSSUploader:
    def __init__(self):
        self.access_key_id = settings.OSS_ACCESS_KEY_ID
        self.access_key_secret = settings.OSS_ACCESS_KEY_SECRET
        self.bucket_name = settings.OSS_BUCKET_NAME
        self.endpoint = settings.OSS_ENDPOINT
        self.cdn_domain = settings.OSS_CDN_DOMAIN

        if not all([self.access_key_id, self.access_key_secret, self.bucket_name]):
            raise ValueError("OSS configuration missing. Check .env file")

        self.auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        self.bucket = oss2.Bucket(self.auth, self.endpoint, self.bucket_name)

        # Statistics
        self.stats = {
            "total_files": 0,
            "uploaded": 0,
            "skipped": 0,
            "failed": 0,
            "original_size_mb": 0,
            "uploaded_size_mb": 0,
        }

    def get_url(self, object_key: str) -> str:
        if self.cdn_domain:
            return f"https://{self.cdn_domain}/{object_key}"
        return f"https://{self.bucket_name}.{self.endpoint}/{object_key}"

    def convert_to_webp(self, image_path: Path) -> tuple[bytes, str]:
        """Convert image to WebP format"""
        img = Image.open(image_path)

        # Handle transparency
        if img.mode == 'P':
            img = img.convert('RGBA')
        elif img.mode == 'LA':
            img = img.convert('RGBA')
        elif img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')

        output = io.BytesIO()
        img.save(output, format='WEBP', quality=WEBP_QUALITY, method=4)
        return output.getvalue(), 'webp'

    def compute_hash(self, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()[:12]

    def check_exists(self, object_key: str) -> bool:
        """Check if object already exists in OSS"""
        try:
            self.bucket.head_object(object_key)
            return True
        except oss2.exceptions.NotFound:
            return False

    def upload_image(self, local_path: Path, relative_path: str) -> tuple[str, str] | None:
        """Upload image, converting to WebP first"""
        try:
            original_size = local_path.stat().st_size
            self.stats["original_size_mb"] += original_size / (1024 * 1024)

            # Read and convert to WebP
            webp_data, _ = self.convert_to_webp(local_path)
            data_hash = self.compute_hash(webp_data)

            # Generate OSS path: dnd-static/images/{relative_path_with_hash}.webp
            path_parts = Path(relative_path)
            new_filename = f"{path_parts.stem}_{data_hash}.webp"
            # Handle root-level files (parent is '.')
            if path_parts.parent == Path('.'):
                object_key = f"dnd-static/{new_filename}"
            else:
                object_key = f"dnd-static/{path_parts.parent}/{new_filename}"

            # Check if already exists
            if self.check_exists(object_key):
                self.stats["skipped"] += 1
                return relative_path, self.get_url(object_key)

            # Upload
            result = self.bucket.put_object(
                object_key,
                webp_data,
                headers={
                    "Content-Type": "image/webp",
                    "Cache-Control": "public, max-age=31536000",
                }
            )

            if result.status == 200:
                self.stats["uploaded"] += 1
                self.stats["uploaded_size_mb"] += len(webp_data) / (1024 * 1024)
                return relative_path, self.get_url(object_key)
            else:
                self.stats["failed"] += 1
                return None

        except Exception as e:
            print(f"Error uploading {local_path}: {e}")
            self.stats["failed"] += 1
            return None

    def upload_audio(self, local_path: Path, relative_path: str) -> tuple[str, str] | None:
        """Upload audio file directly"""
        try:
            original_size = local_path.stat().st_size
            self.stats["original_size_mb"] += original_size / (1024 * 1024)

            with open(local_path, 'rb') as f:
                audio_data = f.read()

            data_hash = self.compute_hash(audio_data)

            # Keep original extension for audio
            path_parts = Path(relative_path)
            new_filename = f"{path_parts.stem}_{data_hash}{path_parts.suffix}"
            # Handle root-level files (parent is '.')
            if path_parts.parent == Path('.'):
                object_key = f"dnd-static/{new_filename}"
            else:
                object_key = f"dnd-static/{path_parts.parent}/{new_filename}"

            # Check if already exists
            if self.check_exists(object_key):
                self.stats["skipped"] += 1
                return relative_path, self.get_url(object_key)

            # Determine content type
            ext = path_parts.suffix.lower()
            content_types = {
                '.mp3': 'audio/mpeg',
                '.ogg': 'audio/ogg',
                '.wav': 'audio/wav',
                '.m4a': 'audio/mp4',
            }
            content_type = content_types.get(ext, 'application/octet-stream')

            result = self.bucket.put_object(
                object_key,
                audio_data,
                headers={
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=31536000",
                }
            )

            if result.status == 200:
                self.stats["uploaded"] += 1
                self.stats["uploaded_size_mb"] += len(audio_data) / (1024 * 1024)
                return relative_path, self.get_url(object_key)
            else:
                self.stats["failed"] += 1
                return None

        except Exception as e:
            print(f"Error uploading {local_path}: {e}")
            self.stats["failed"] += 1
            return None

    def upload_svg(self, local_path: Path, relative_path: str) -> tuple[str, str] | None:
        """Upload SVG file directly (no conversion)"""
        try:
            original_size = local_path.stat().st_size
            self.stats["original_size_mb"] += original_size / (1024 * 1024)

            with open(local_path, 'rb') as f:
                svg_data = f.read()

            data_hash = self.compute_hash(svg_data)

            path_parts = Path(relative_path)
            new_filename = f"{path_parts.stem}_{data_hash}.svg"
            # Handle root-level files (parent is '.')
            if path_parts.parent == Path('.'):
                object_key = f"dnd-static/{new_filename}"
            else:
                object_key = f"dnd-static/{path_parts.parent}/{new_filename}"

            if self.check_exists(object_key):
                self.stats["skipped"] += 1
                return relative_path, self.get_url(object_key)

            result = self.bucket.put_object(
                object_key,
                svg_data,
                headers={
                    "Content-Type": "image/svg+xml",
                    "Cache-Control": "public, max-age=31536000",
                }
            )

            if result.status == 200:
                self.stats["uploaded"] += 1
                self.stats["uploaded_size_mb"] += len(svg_data) / (1024 * 1024)
                return relative_path, self.get_url(object_key)
            else:
                self.stats["failed"] += 1
                return None

        except Exception as e:
            print(f"Error uploading {local_path}: {e}")
            self.stats["failed"] += 1
            return None

    def upload_file(self, local_path: Path, relative_path: str) -> tuple[str, str] | None:
        """Upload a file based on its type"""
        ext = local_path.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            return self.upload_image(local_path, relative_path)
        elif ext in SVG_EXTENSIONS:
            return self.upload_svg(local_path, relative_path)
        elif ext in AUDIO_EXTENSIONS:
            return self.upload_audio(local_path, relative_path)
        return None


def collect_files() -> list[tuple[Path, str]]:
    """Collect all files to upload"""
    files = []

    # Process directories
    for asset_dir in ASSET_DIRS:
        dir_path = FRONTEND_PUBLIC_DIR / asset_dir
        if not dir_path.exists():
            print(f"Directory not found, skipping: {asset_dir}")
            continue

        for file_path in dir_path.rglob("*"):
            if file_path.is_file():
                ext = file_path.suffix.lower()
                if ext in IMAGE_EXTENSIONS or ext in SVG_EXTENSIONS or ext in AUDIO_EXTENSIONS:
                    relative_path = str(file_path.relative_to(FRONTEND_PUBLIC_DIR))
                    files.append((file_path, relative_path))

    # Process root-level files
    for root_file in ROOT_FILES:
        file_path = FRONTEND_PUBLIC_DIR / root_file
        if file_path.exists():
            files.append((file_path, root_file))
        else:
            print(f"Root file not found, skipping: {root_file}")

    return files


def main():
    print("=" * 60)
    print("Static Assets to OSS Upload Tool")
    print("=" * 60)

    # Verify OSS config
    print(f"\nOSS Bucket: {settings.OSS_BUCKET_NAME}")
    print(f"OSS Endpoint: {settings.OSS_ENDPOINT}")
    print(f"CDN Domain: {settings.OSS_CDN_DOMAIN or 'Not configured'}")

    # Collect files
    print("\nCollecting files...")
    files = collect_files()
    print(f"Found {len(files)} files to process")

    if not files:
        print("No files to upload.")
        return

    # Initialize uploader
    uploader = OSSUploader()
    uploader.stats["total_files"] = len(files)

    # Upload with progress bar
    mapping = {}
    print(f"\nUploading with {MAX_WORKERS} workers...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(uploader.upload_file, local_path, relative_path): relative_path
            for local_path, relative_path in files
        }

        for future in tqdm(as_completed(futures), total=len(futures), desc="Uploading"):
            result = future.result()
            if result:
                original_path, oss_url = result
                mapping[original_path] = oss_url

    # Save mapping file
    print(f"\nSaving mapping to {OUTPUT_MAPPING_FILE}...")
    with open(OUTPUT_MAPPING_FILE, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)

    # Print statistics
    print("\n" + "=" * 60)
    print("Upload Statistics")
    print("=" * 60)
    print(f"Total files:      {uploader.stats['total_files']}")
    print(f"Uploaded:         {uploader.stats['uploaded']}")
    print(f"Skipped (exists): {uploader.stats['skipped']}")
    print(f"Failed:           {uploader.stats['failed']}")
    print(f"Original size:    {uploader.stats['original_size_mb']:.2f} MB")
    print(f"Uploaded size:    {uploader.stats['uploaded_size_mb']:.2f} MB")
    if uploader.stats['original_size_mb'] > 0:
        ratio = (1 - uploader.stats['uploaded_size_mb'] / uploader.stats['original_size_mb']) * 100
        print(f"Size reduction:   {ratio:.1f}%")
    print("=" * 60)
    print(f"\nMapping saved to: {OUTPUT_MAPPING_FILE}")
    print("Next step: Update frontend code to use OSS URLs")


if __name__ == "__main__":
    main()
