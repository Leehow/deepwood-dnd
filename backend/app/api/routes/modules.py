"""
Module management API endpoints - Two-column layout
Left: Raw files (PDF/Markdown/ZIP)
Right: Parsed modules (structured data)
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, status, WebSocket, WebSocketDisconnect, Body, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from pydantic import BaseModel
import asyncio
import json
import logging
import re
import shutil
from pathlib import Path
import os
from datetime import datetime
import uuid
import zipfile
import tempfile

from app.utils.permissions import require_admin, is_admin
from app.services import module_file_manager
from app.db.session import get_db, async_session_maker
from app.models.raw_module_file import RawModuleFile
from app.models.parsed_module import ParsedModule
from app.services.module_snapshot_service import (
    build_db_module_detail_payload,
    build_export_filename,
    build_export_payload,
    build_import_models,
    can_access_module,
    deduplicate_import_title,
    dump_export_json,
    normalize_legacy_module_payload,
)
from app.services.module_task_flow_service import (
    delete_module_embedding_records,
    get_module_embedding_status,
    get_required_module,
    trigger_module_embedding,
)
from app.services.module_extraction_stream_service import (
    build_item_extraction_response,
    build_monster_extraction_response,
)
from app.services.module_parse_task_service import (
    get_active_parse_task_for_file,
    get_parse_task_by_id,
    stop_parse_task_and_mark_file,
)
from app.services.module_parse_websocket_service import (
    run_parse_raw_file_ws_session,
    run_parse_raw_file_ws_v2_session,
)
from app.services.module_translation_service import (
    build_module_translation_response,
    get_owned_module_with_toc,
    translate_single_module_chapter,
)
from app.core.security import decode_token, require_auth

router = APIRouter(prefix="/api/modules", tags=["modules"])
logger = logging.getLogger(__name__)


def _current_user_id(current_user: dict = Depends(require_auth)) -> str:
    return str(current_user["user_id"])


async def _check_parse_websocket_access(db: AsyncSession, file_id: str, user_id: str) -> None:
    if user_id == "0":
        return
    try:
        raw_id = int(file_id)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can parse legacy files without numeric id",
        )

    result = await db.execute(
        select(RawModuleFile).where(RawModuleFile.id == raw_id)
    )
    raw_file = result.scalar_one_or_none()
    if not raw_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Raw file not found")
    if raw_file.created_by != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to parse this file")

# Storage directories
from app.utils.rules_cache import PROJECT_ROOT
RAW_FILES_DIR = PROJECT_ROOT / "dnd-platform" / "upload"
PARSED_MODULES_DIR = PROJECT_ROOT / "dnd-platform" / "configs" / "modules"
RAW_FILES_DIR.mkdir(parents=True, exist_ok=True)
PARSED_MODULES_DIR.mkdir(parents=True, exist_ok=True)

# Metadata files
RAW_METADATA_FILE = RAW_FILES_DIR / "raw_files_metadata.json"
PARSED_METADATA_FILE = PARSED_MODULES_DIR / "parsed_modules_metadata.json"
PARSE_TASKS_FILE = RAW_FILES_DIR / "parse_tasks.json"


async def update_task_progress(
    task_id: str,
    step: str,
    message: str,
    progress: int,
    websocket: WebSocket = None
):
    """Update task progress and send to WebSocket"""
    # Update task using file manager (run in thread pool to avoid blocking)
    await asyncio.to_thread(
        module_file_manager.update_task_progress,
        task_id, step, message, progress, True
    )

    # Yield control to event loop to allow other requests to process
    await asyncio.sleep(0)

    # Send to WebSocket if connected
    if websocket:
        try:
            await websocket.send_json({
                "type": "progress",
                "step": step,
                "message": message,
                "progress": progress
            })
        except:
            # WebSocket disconnected, but task continues
            pass


# ===== RAW FILES ENDPOINTS =====

@router.get("/raw", response_model=List[dict])
async def list_raw_files(
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """List raw files - admin sees all, users see only their own"""
    # Admin can see all files
    user_is_admin = await is_admin(x_user_id, db)
    if user_is_admin:
        result = await db.execute(select(RawModuleFile).order_by(RawModuleFile.created_at.desc()))
    else:
        # Users only see their own files (private)
        result = await db.execute(
            select(RawModuleFile)
            .where(RawModuleFile.created_by == x_user_id)
            .order_by(RawModuleFile.created_at.desc())
        )

    files = result.scalars().all()
    return [
        {
            "id": str(f.id),
            "title": f.title,
            "file_name": f.original_filename,
            "file_size": f.file_size,
            "file_type": f.file_type,
            "upload_date": f.created_at.isoformat() if f.created_at else None,
            "status": f.status,
            "uploaded_by": f.created_by,
            "ocr_provider": f.ocr_provider,
        }
        for f in files
    ]


@router.post("/raw/upload", status_code=status.HTTP_201_CREATED)
async def upload_raw_file(
    file: UploadFile = File(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Upload a raw PDF, Markdown, or ZIP file"""
    # Validate file type
    if not (file.filename.endswith('.pdf') or file.filename.endswith('.md') or file.filename.endswith('.zip')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF, Markdown, and ZIP files are allowed"
        )

    # Generate unique file ID (use UUID to avoid filename encoding issues)
    file_id = str(uuid.uuid4())

    # Extract original filename without extension for title
    original_filename = file.filename
    if original_filename.endswith('.pdf'):
        title = original_filename[:-4]
        file_extension = 'pdf'
    elif original_filename.endswith('.md'):
        title = original_filename[:-3]
        file_extension = 'md'
    else:  # .zip
        title = original_filename[:-4]
        file_extension = 'zip'

    # Read file content
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}"
        )

    # Determine file type and handle accordingly
    if file_extension == 'zip':
        # Handle ZIP file - extract and store with UUID directory name
        file_type = "zip"
        zip_dir = RAW_FILES_DIR / file_id  # Use UUID as directory name
        zip_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Save ZIP file temporarily with UUID name
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_file:
                tmp_file.write(content)
                tmp_zip_path = tmp_file.name

            # Extract ZIP file with UTF-8 encoding support
            with zipfile.ZipFile(tmp_zip_path, 'r') as zip_ref:
                # Extract all files, handling encoding properly
                for member in zip_ref.namelist():
                    # Extract with proper encoding
                    try:
                        # Try UTF-8 first
                        member_path = member.encode('cp437').decode('utf-8')
                    except:
                        # Fallback to original
                        member_path = member

                    # Get target path
                    target_path = zip_dir / member_path

                    # Check if it's a directory
                    if member.endswith('/'):
                        # Create directory
                        target_path.mkdir(parents=True, exist_ok=True)
                    else:
                        # Create parent directories
                        target_path.parent.mkdir(parents=True, exist_ok=True)

                        # Extract the file
                        with zip_ref.open(member) as source:
                            with open(target_path, 'wb') as target:
                                shutil.copyfileobj(source, target)

            # Clean up temporary ZIP file
            os.unlink(tmp_zip_path)

            # Find the .md file in extracted contents
            md_files = list(zip_dir.rglob('*.md'))
            if not md_files:
                # Clean up if no .md file found
                shutil.rmtree(zip_dir)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="ZIP file must contain at least one .md file"
                )

            # If title from filename is not good, use the first .md file name
            if not title or title == file_id:
                md_file = md_files[0]
                title = md_file.stem

        except zipfile.BadZipFile:
            # Clean up on error
            if zip_dir.exists():
                shutil.rmtree(zip_dir)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid ZIP file"
            )
        except Exception as e:
            # Clean up on error
            if zip_dir.exists():
                shutil.rmtree(zip_dir)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to extract ZIP file: {str(e)}"
            )
    else:
        # Handle PDF or Markdown file - save with UUID filename
        file_type = "pdf" if file_extension == 'pdf' else "markdown"
        # Use UUID as filename to avoid encoding issues
        safe_filename = f"{file_id}.{file_extension}"
        file_path = RAW_FILES_DIR / safe_filename

        try:
            with open(file_path, "wb") as f:
                f.write(content)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to save file: {str(e)}"
            )

    # Create database record
    markdown_content = None
    if file_type == "markdown":
        # For markdown files, read content directly
        with open(file_path, "r", encoding="utf-8") as f:
            markdown_content = f.read()
        # Delete the file since content is in DB
        file_path.unlink()
    elif file_type == "zip":
        # For zip files, find and read the markdown file
        zip_dir = RAW_FILES_DIR / file_id
        md_files = list(zip_dir.rglob('*.md'))
        if md_files:
            with open(md_files[0], "r", encoding="utf-8") as f:
                markdown_content = f.read()
            # Clean up zip directory
            shutil.rmtree(zip_dir)

    raw_file = RawModuleFile(
        title=title,
        original_filename=original_filename,
        file_type=file_type,
        file_size=len(content),
        status="converted" if markdown_content else "uploaded",
        markdown_content=markdown_content,
        created_by=x_user_id
    )

    try:
        db.add(raw_file)
        await db.commit()
        await db.refresh(raw_file)

        # For PDF files, rename from UUID to database ID
        if file_type == "pdf":
            old_path = RAW_FILES_DIR / f"{file_id}.pdf"
            new_path = RAW_FILES_DIR / f"{raw_file.id}.pdf"
            if old_path.exists():
                old_path.rename(new_path)

    except Exception as e:
        await db.rollback()
        # Clean up file if DB save fails
        if file_type == "pdf":
            file_path = RAW_FILES_DIR / f"{file_id}.pdf"
            if file_path.exists():
                file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save to database: {str(e)}"
        )

    return {
        "message": "File uploaded successfully",
        "file_id": str(raw_file.id),
        "file_data": {
            "id": str(raw_file.id),
            "title": raw_file.title,
            "file_name": raw_file.original_filename,
            "file_size": raw_file.file_size,
            "file_type": raw_file.file_type,
            "status": raw_file.status,
            "uploaded_by": raw_file.created_by,
            "ocr_provider": raw_file.ocr_provider,
        }
    }


@router.websocket("/ws/parse-v2/{file_id}")
async def parse_raw_file_ws_v2(websocket: WebSocket, file_id: str, token: str = Query(...)):
    """
    新版解析流程 - 使用简化的pipeline
    6步流程: OCR -> OSS上传 -> 图片分类(可选) -> TOC提取 -> 存数据库
    """
    try:
        current_user = decode_token(token)
        user_id = str(current_user["user_id"])
        async with async_session_maker() as db:
            await _check_parse_websocket_access(db, file_id, user_id)
            await websocket.accept()
            await run_parse_raw_file_ws_v2_session(
                file_id=file_id,
                db=db,
                send_json=websocket.send_json,
                raw_files_dir=RAW_FILES_DIR,
            )
    except HTTPException as exc:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": str(exc.detail)})
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        print(f"Parse-v2 WebSocket disconnected for file {file_id}")
    except Exception as e:
        print(f"Parse-v2 websocket parse failed: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/parse/{file_id}")
async def parse_raw_file_ws(websocket: WebSocket, file_id: str, token: str = Query(...)):
    """Parse a raw file (PDF/Markdown/ZIP) with real-time progress updates via WebSocket"""
    try:
        current_user = decode_token(token)
        user_id = str(current_user["user_id"])
        async with async_session_maker() as db:
            await _check_parse_websocket_access(db, file_id, user_id)
            await websocket.accept()

            async def send_progress(_task_id: str, step: str, message: str, progress: int) -> None:
                await update_task_progress(_task_id, step, message, progress, websocket)

            await run_parse_raw_file_ws_session(
                file_id=file_id,
                db=db,
                progress_sender=send_progress,
                send_json=websocket.send_json,
                raw_files_dir=RAW_FILES_DIR,
            )
    except HTTPException as exc:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": str(exc.detail)})
        await websocket.close(code=1008)

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for file {file_id}")
    except Exception as e:
        print(f"Parse error: {e}")
    finally:
        try:
            await websocket.close()
        except:
            pass




@router.post("/raw/{file_id}/reclassify-images", status_code=status.HTTP_200_OK)
async def reclassify_unknown_images(
    file_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Reclassify images that have 'unknown' category"""
    from app.services.module_image_classifier import module_image_classifier

    # Get the raw file
    result = await db.execute(
        select(RawModuleFile).where(RawModuleFile.id == int(file_id) if file_id.isdigit() else -1)
    )
    raw_file = result.scalar_one_or_none()

    if not raw_file:
        raise HTTPException(status_code=404, detail="File not found")

    ocr_images = raw_file.ocr_images or []
    current_classifications = raw_file.image_classifications or []

    if not ocr_images:
        raise HTTPException(status_code=400, detail="No OCR images available for this file")

    # Build a map of existing classifications by image_id
    existing_map = {c.get("image_id"): c for c in current_classifications}

    # Find images that need reclassification (unknown or missing)
    images_to_classify = []
    indices_to_update = []

    for i, img in enumerate(ocr_images):
        image_id = img.get("image_id")
        existing = existing_map.get(image_id)
        if not existing or existing.get("category") == "unknown":
            images_to_classify.append(img)
            indices_to_update.append(i)

    if not images_to_classify:
        return {"message": "No unknown images to reclassify", "reclassified": 0}

    # Reclassify the unknown images
    try:
        classifications = await module_image_classifier.classify_images_batch(
            db=db,
            images=images_to_classify,
            progress_callback=None
        )

        # Update the classifications
        reclassified_count = 0
        for idx, classification in zip(indices_to_update, classifications):
            img_info = ocr_images[idx]
            image_id = img_info.get("image_id")

            new_classification = {
                "image_id": image_id,
                "oss_url": img_info.get("oss_url", ""),
                "thumbnail_url": img_info.get("thumbnail_url", ""),
                "category": classification.category.value,
                "description": classification.description,
                "confidence": classification.confidence,
                "related_entity": classification.related_entity,
                "chapter": img_info.get("chapter", ""),
                "page_index": img_info.get("page_index", 0)
            }

            # Update or add to existing classifications
            existing_map[image_id] = new_classification
            if classification.category.value != "unknown":
                reclassified_count += 1

        # Rebuild the classifications list preserving order
        updated_classifications = []
        for img in ocr_images:
            image_id = img.get("image_id")
            if image_id in existing_map:
                updated_classifications.append(existing_map[image_id])

        # Save to raw file database
        raw_file.image_classifications = updated_classifications

        # Also update ParsedModule.images if exists
        if raw_file.parsed_module_id:
            parsed_result = await db.execute(
                select(ParsedModule).where(ParsedModule.module_id == raw_file.parsed_module_id)
            )
            parsed_module = parsed_result.scalar_one_or_none()
            if parsed_module:
                parsed_module.images = updated_classifications

        await db.commit()

        return {
            "message": f"Reclassified {reclassified_count} images successfully",
            "reclassified": reclassified_count,
            "total_processed": len(images_to_classify),
            "still_unknown": len(images_to_classify) - reclassified_count
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


@router.delete("/raw/{file_id}", status_code=status.HTTP_200_OK)
async def delete_raw_file(
    file_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Delete a raw file (uploader or admin only)"""
    # Query from database
    result = await db.execute(
        select(RawModuleFile).where(RawModuleFile.id == int(file_id) if file_id.isdigit() else -1)
    )
    raw_file = result.scalar_one_or_none()

    if not raw_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File '{file_id}' not found"
        )

    # Check ownership: only uploader or admin can delete
    user_is_admin = await is_admin(x_user_id, db)
    if raw_file.created_by != x_user_id and not user_is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file uploader or admin can delete this file"
        )

    # Delete any remaining physical files
    file_type = raw_file.file_type
    try:
        if file_type == "zip":
            zip_dir = RAW_FILES_DIR / str(raw_file.id)
            if zip_dir.exists():
                shutil.rmtree(zip_dir)
        else:
            # PDF files should already be deleted after conversion
            file_extension = "pdf" if file_type == "pdf" else "md"
            file_path = RAW_FILES_DIR / f"{raw_file.id}.{file_extension}"
            if file_path.exists():
                file_path.unlink()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete file: {str(e)}"
        )

    # Delete from database
    await db.delete(raw_file)
    await db.commit()

    return {
        "message": "File deleted successfully",
        "file_id": file_id
    }


# ===== PARSED MODULES ENDPOINTS =====

@router.get("/parsed", response_model=List[dict])
async def list_parsed_modules(
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """List user's own modules (不包括共享模组，共享模组在单独的端点)"""
    # Try database first - 按解析时间降序排列（最新的在前）
    result = await db.execute(
        select(ParsedModule)
        .where(ParsedModule.created_by == x_user_id)
        .order_by(ParsedModule.parsed_date.desc())
    )
    db_modules = result.scalars().all()

    if db_modules:
        return [
            {
                "id": m.module_id,
                "title": m.title,
                "title_en": m.title_en,
                "description": m.description,
                "chapters_count": m.chapters_count or 0,
                "monsters_count": m.monsters_count or 0,
                "items_count": m.items_count or 0,
                "images_count": m.images_count or 0,
                "source_file_id": m.source_file_id,
                "data_file": m.data_file,
                "parsed_date": m.parsed_date.isoformat() if m.parsed_date else None,
                "created_by": m.created_by,
                "is_shared": m.is_shared or False,
                "original_module_id": m.original_module_id
            }
            for m in db_modules
        ]

    # Fall back to JSON file
    metadata = module_file_manager.load_parsed_metadata()
    return [m for m in metadata if m.get("created_by") == x_user_id]

@router.get("/tasks/{file_id}")
async def get_parse_task(file_id: str, db: AsyncSession = Depends(get_db)):
    """Get active parse task for a file - used for HTTP polling"""
    try:
        return {"task": await get_active_parse_task_for_file(file_id, db)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/by-id/{task_id}")
async def get_task_by_task_id(task_id: str, db: AsyncSession = Depends(get_db)):
    """Get task by task ID - used for progress polling"""
    try:
        return {"task": await get_parse_task_by_id(task_id, db)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tasks/{task_id}/stop")
async def stop_parse_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """Stop an active parse task"""
    try:
        return await stop_parse_task_and_mark_file(task_id, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/parsed/{module_id}", status_code=status.HTTP_200_OK)
async def delete_parsed_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Delete a parsed module (creator or admin only)"""
    # Try database first
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if db_module:
        # Check ownership
        user_is_admin = await is_admin(x_user_id, db)
        if x_user_id != db_module.created_by and not user_is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the module creator or admin can delete this module"
            )

        # Delete module directory
        module_dir = PARSED_MODULES_DIR / module_id
        if module_dir.exists():
            try:
                shutil.rmtree(module_dir)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to delete module directory: {str(e)}"
                )

        # Delete from database
        await db.delete(db_module)
        await db.commit()

        # Also remove from JSON file for consistency
        metadata = module_file_manager.load_parsed_metadata()
        metadata = [m for m in metadata if m["id"] != module_id]
        module_file_manager.save_parsed_metadata(metadata)

        return {"message": "Module deleted successfully", "module_id": module_id}

    # Fall back to JSON
    metadata = module_file_manager.load_parsed_metadata()
    module = None
    for m in metadata:
        if m["id"] == module_id:
            module = m
            break

    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module '{module_id}' not found"
        )

    creator = module.get("created_by", "0")
    user_is_admin = await is_admin(x_user_id, db)
    if x_user_id != creator and not user_is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the module creator or admin can delete this module"
        )

    module_dir = PARSED_MODULES_DIR / module_id
    if module_dir.exists():
        try:
            shutil.rmtree(module_dir)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete module directory: {str(e)}"
            )

    metadata = [m for m in metadata if m["id"] != module_id]
    module_file_manager.save_parsed_metadata(metadata)

    return {"message": "Module deleted successfully", "module_id": module_id}


@router.post("/parsed/{module_id}/reparse")
async def reparse_module_partial(
    module_id: str,
    reparse_monsters: bool = False,
    reparse_items: bool = False,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Partially reparse a module (monsters and/or items only)"""
    # Load metadata
    metadata = module_file_manager.load_parsed_metadata()

    # Find module
    module = None
    for m in metadata:
        if m["id"] == module_id:
            module = m
            break

    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module '{module_id}' not found"
        )

    # Check ownership
    creator = module.get("created_by", "0")
    user_is_admin = await is_admin(x_user_id, db)
    if x_user_id != creator and not user_is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the module creator can reparse this module"
        )

    # Get source file
    source_file_id = module.get("source_file_id")
    if not source_file_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Module has no source file"
        )

    # Find markdown file
    upload_dir = RAW_FILES_DIR / source_file_id
    converted_dir = upload_dir / "converted"
    md_file = converted_dir / "converted.md"

    if not md_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source markdown file not found"
        )

    try:
        # Get AI settings
        from app.services.module_parsing_service import get_ai_settings_from_db, ModuleParsingService
        ai_settings = await get_ai_settings_from_db()
        if not ai_settings:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="AI settings not configured"
            )

        # Parse with selective skipping
        parsing_service = ModuleParsingService(
            ai_settings=ai_settings,
            output_dir=upload_dir / "parsed"
        )

        result = await parsing_service.parse_module_file(
            markdown_path=md_file,
            progress_callback=None,
            skip_monsters=not reparse_monsters,
            skip_items=not reparse_items
        )

        # Load existing module data
        data_file = PARSED_MODULES_DIR / f"{module_id}.json"
        if data_file.exists():
            with open(data_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        else:
            existing_data = {}

        # Update only the reparsed parts
        if reparse_monsters and result.get('monsters'):
            existing_data['monsters'] = result['monsters']
        if reparse_items and result.get('items'):
            existing_data['items'] = result['items']

        # Update stats
        if 'stats' not in existing_data:
            existing_data['stats'] = {}
        if reparse_monsters:
            existing_data['stats']['monsters_count'] = len(result.get('monsters', []))
        if reparse_items:
            existing_data['stats']['items_count'] = len(result.get('items', []))

        # Save updated data
        with open(data_file, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        # Update metadata counts
        for m in metadata:
            if m["id"] == module_id:
                if reparse_monsters:
                    m["monsters_count"] = len(result.get('monsters', []))
                if reparse_items:
                    m["items_count"] = len(result.get('items', []))
                break
        module_file_manager.save_parsed_metadata(metadata)

        # Clean up intermediate JSON files
        parsed_dir = upload_dir / "parsed"
        if parsed_dir.exists():
            shutil.rmtree(parsed_dir)

        return {
            "message": "Partial reparse completed",
            "monsters_count": len(result.get('monsters', [])) if reparse_monsters else None,
            "items_count": len(result.get('items', [])) if reparse_items else None
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reparse failed: {str(e)}"
        )


@router.get("/parsed/{module_id}", response_model=dict)
async def get_parsed_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed information about a parsed module including full data"""
    print(f"[Module API] GET /parsed/{module_id} - current_user_id: '{x_user_id}'")

    # Try database first
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if db_module:
        print(f"[Module API] Module found in DB: created_by='{db_module.created_by}', is_shared={db_module.is_shared}")
        # Check permissions
        if not can_access_module(
            created_by=db_module.created_by,
            requester_id=x_user_id,
            is_shared=bool(db_module.is_shared),
        ):
            print(f"[Module API] Access denied: '{db_module.created_by}' != '{x_user_id}' and not shared")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to access this module"
            )

        # Fetch translation status from raw file
        translation_info = {"is_translated": "unknown", "source_language": None}
        if db_module.source_file_id:
            try:
                raw_res = await db.execute(
                    select(RawModuleFile.is_translated, RawModuleFile.source_language)
                    .where(RawModuleFile.id == int(db_module.source_file_id))
                )
                raw_row = raw_res.first()
                if raw_row:
                    translation_info = {
                        "is_translated": raw_row.is_translated or "no",
                        "source_language": raw_row.source_language
                    }
            except Exception:
                pass
        return build_db_module_detail_payload(
            db_module=db_module,
            translation_info=translation_info,
        )

    # Fall back to JSON file for legacy data
    metadata = module_file_manager.load_parsed_metadata()

    for module in metadata:
        if module["id"] == module_id:
            print(f"[Module API] Module found in JSON: created_by='{module.get('created_by')}', is_shared={module.get('is_shared', False)}")
            # Check if user has access (creator or shared)
            if not can_access_module(
                created_by=module.get("created_by"),
                requester_id=x_user_id,
                is_shared=bool(module.get("is_shared", False)),
            ):
                print(f"[Module API] Access denied: '{module.get('created_by')}' != '{x_user_id}' and not shared")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have permission to access this module"
                )

            # Load full data from data file
            data_file = PARSED_MODULES_DIR / module.get("data_file", f"{module_id}.json")
            if data_file.exists():
                with open(data_file, "r", encoding="utf-8") as f:
                    full_data = json.load(f)
                return normalize_legacy_module_payload(
                    full_data,
                    created_by=module.get("created_by"),
                )
            else:
                # Return just metadata if data file doesn't exist
                return module

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Module '{module_id}' not found"
    )


@router.get("/parsed/{module_id}/markdown", response_model=dict)
async def get_parsed_module_markdown(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Return the Markdown source of a parsed module's underlying file.
    Permission: creator or shared.
    """
    # Try database first (new flow)
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if db_module:
        # Permission check
        user_is_admin = await is_admin(x_user_id, db)
        if not can_access_module(
            created_by=db_module.created_by,
            requester_id=x_user_id,
            is_shared=bool(db_module.is_shared),
            is_admin=user_is_admin,
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

        # Get markdown from raw file
        source_file_id = db_module.source_file_id
        if source_file_id:
            try:
                file_id = int(source_file_id)
                raw_result = await db.execute(select(RawModuleFile).where(RawModuleFile.id == file_id))
                raw_file = raw_result.scalar_one_or_none()
                if raw_file and raw_file.markdown_content:
                    return {"markdown": raw_file.markdown_content}
            except (ValueError, TypeError):
                pass

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Markdown not found")

    # Fallback to JSON file metadata (legacy)
    metadata = module_file_manager.load_parsed_metadata()
    target = None
    for m in metadata:
        if m.get("id") == module_id:
            target = m
            break
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Module '{module_id}' not found")

    # Permission check
    if not can_access_module(
        created_by=target.get("created_by"),
        requester_id=x_user_id,
        is_shared=bool(target.get("is_shared", False)),
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    # Get source_file_id and try to find markdown from database first
    source_file_id = target.get("source_file_id")
    if not source_file_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Module missing source_file_id")

    # Try database first (new flow)
    try:
        file_id = int(source_file_id)
        result = await db.execute(select(RawModuleFile).where(RawModuleFile.id == file_id))
        raw_file = result.scalar_one_or_none()
        if raw_file and raw_file.markdown_content:
            return {"markdown": raw_file.markdown_content}
    except (ValueError, TypeError):
        pass  # source_file_id is not an integer, try legacy flow

    # Fallback to legacy file-based metadata
    raw_meta = module_file_manager.load_raw_metadata()
    md_path = None
    for f in raw_meta:
        if f.get("id") == source_file_id:
            md_path = f.get("markdown_path")
            break
    if not md_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Markdown not found")

    md_file = Path(md_path)
    if not md_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Markdown file not found on disk")

    try:
        text = md_file.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to read markdown: {e}")

    return {"markdown": text}



@router.get("/parsed/{module_id}/asset")
async def get_parsed_module_asset(module_id: str, path: str, x_user_id: str = Depends(_current_user_id)):
    """Serve an asset (e.g., map image) for a parsed module."""
    # Normalize relative path
    safe_rel = path.lstrip("/\\")

    metadata = module_file_manager.load_parsed_metadata()
    for module in metadata:
        if module.get("id") == module_id:
            # Permission check: same as get_parsed_module
            if module.get("created_by") != x_user_id and not module.get("is_shared", False):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have permission to access this module"
                )

            source_file_id = module.get("source_file_id")
            if not source_file_id:
                raise HTTPException(status_code=404, detail="Source file not found for module")

            # Try parsed directory first (for JSON assets like monsters.json, items.json, etc.)
            parsed_dir = (RAW_FILES_DIR / source_file_id / "parsed").resolve()
            parsed_target = (parsed_dir / safe_rel).resolve()

            # Fallback to converted directory (for images and other assets)
            converted_dir = (RAW_FILES_DIR / source_file_id / "converted").resolve()
            converted_target = (converted_dir / safe_rel).resolve()

            # Check which path exists
            target = None
            base_dir = None

            if parsed_target.exists() and parsed_target.is_file():
                # Prevent path traversal
                if str(parsed_target).startswith(str(parsed_dir)):
                    target = parsed_target
                    base_dir = parsed_dir
            elif converted_target.exists() and converted_target.is_file():
                # Prevent path traversal
                if str(converted_target).startswith(str(converted_dir)):
                    target = converted_target
                    base_dir = converted_dir

            if not target or not base_dir:
                raise HTTPException(status_code=404, detail="Asset not found")

            # Lazy import to avoid heavy imports at module load
            from fastapi.responses import FileResponse  # type: ignore
            return FileResponse(
                str(target),
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "*"
                }
            )

    raise HTTPException(status_code=404, detail=f"Module '{module_id}' not found")



async def generate_title_and_description(content: str, filename: str) -> tuple[str, str]:
    """Generate title and description from content using AI"""
    try:
        # Get AI settings from database
        from app.db.session import get_db
        from app.services.ai_model_service import ai_model_service

        async for db in get_db():
            # Get model config and params via usage config (module_title_generation)
            try:
                usage_params = await ai_model_service.get_usage_params(db, "module_title_generation")
                title_config = usage_params.config
                temperature = usage_params.temperature
                max_tokens = usage_params.max_tokens
            except Exception as e:
                print(f"Model config not available: {e}, using default title", flush=True)
                return "未命名模组", f"从 {filename} 解析"

            # Prepare prompt
            prompt = f"""请根据以下D&D模组内容的开头部分，生成一个简洁的标题和描述。

内容开头（前1000字符）：
{content[:1000]}

文件名：{filename}

请以JSON格式返回，包含以下字段：
- title: 模组标题（简洁，10-30字）
- description: 模组简介（50-150字，概括模组的主要内容、背景和特色）

示例格式：
{{
  "title": "失落矿坑的回响",
  "description": "一个适合1-5级冒险者的经典地下城探险模组。玩家将探索被遗弃的矿坑，揭开古老诅咒的秘密，面对地底深处的危险生物。"
}}

请直接返回JSON，不要添加任何其他文字。"""

            # Call AI using generate_completion
            from app.services.ai_service import AIService
            response = await AIService.generate_completion(
                api_url=title_config.api_url,
                api_key=title_config.api_key,
                model=title_config.model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=max_tokens
            )

            # Parse response
            import json
            import re

            # Extract JSON from response
            response_text = response.strip()
            json_match = re.search(r'\{[^{}]*"title"[^{}]*"description"[^{}]*\}', response_text, re.DOTALL)

            if json_match:
                result = json.loads(json_match.group())
                return result.get("title", "未命名模组"), result.get("description", f"从 {filename} 解析")
            else:
                # Fallback: try to parse the whole response
                result = json.loads(response_text)
                return result.get("title", "未命名模组"), result.get("description", f"从 {filename} 解析")

    except Exception as e:
        print(f"Error generating title and description: {e}", flush=True)
        import traceback
        traceback.print_exc()
        # Fallback to default
        return "未命名模组", f"从 {filename} 解析"


@router.put("/parsed/{module_id}/title")
async def update_module_title(
    module_id: str,
    title: str = Body(..., embed=True),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Update module title (creator only)"""
    # 更新数据库
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    parsed_module = result.scalar_one_or_none()

    if parsed_module:
        if parsed_module.created_by != x_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the creator can update this module's title"
            )
        parsed_module.title = title
        parsed_module.title_en = title
        await db.commit()

    # 同时更新 JSON 元数据（兼容旧系统）
    metadata = module_file_manager.load_parsed_metadata()
    for module in metadata:
        if module["id"] == module_id:
            if module.get("created_by") != x_user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the creator can update this module's title"
                )
            module["title"] = title
            module["title_en"] = title
            module_file_manager.save_parsed_metadata(metadata)
            return {"message": "Title updated successfully", "module": module}

    if parsed_module:
        return {"message": "Title updated successfully", "module": {"id": module_id, "title": title}}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Module '{module_id}' not found"
    )


@router.post("/parsed", status_code=status.HTTP_201_CREATED)
async def create_blank_module(
    title: str = Body(...),
    description: str = Body(None),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """创建空白模组"""
    module_id = str(uuid.uuid4())

    parsed_module = ParsedModule(
        module_id=module_id,
        title=title,
        title_en=title,
        description=description or "",
        chapters_count=0,
        monsters_count=0,
        items_count=0,
        images_count=0,
        tables_count=0,
        chapters=[],
        monsters=[],
        items=[],
        images=[],
        tables=[],
        toc=[],
        created_by=x_user_id,
        is_shared=False,
        parsed_date=datetime.utcnow(),
    )

    db.add(parsed_module)
    await db.commit()
    await db.refresh(parsed_module)

    return {
        "message": "Blank module created successfully",
        "module": {
            "id": module_id,
            "title": title,
            "description": description,
            "created_by": x_user_id,
        }
    }


@router.put("/parsed/{module_id}/chapters")
async def update_module_chapters(
    module_id: str,
    chapters: list = Body(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """更新模组章节内容"""
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    parsed_module = result.scalar_one_or_none()

    if not parsed_module:
        raise HTTPException(status_code=404, detail="Module not found")

    if parsed_module.created_by != x_user_id:
        raise HTTPException(status_code=403, detail="Only the creator can edit this module")

    parsed_module.chapters = chapters
    parsed_module.chapters_count = len(chapters)
    await db.commit()

    return {"message": "Chapters updated successfully", "chapters_count": len(chapters)}


@router.put("/parsed/{module_id}/monsters")
async def update_module_monsters(
    module_id: str,
    monsters: list = Body(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """更新模组怪物/NPC列表"""
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    parsed_module = result.scalar_one_or_none()

    if not parsed_module:
        raise HTTPException(status_code=404, detail="Module not found")

    if parsed_module.created_by != x_user_id:
        raise HTTPException(status_code=403, detail="Only the creator can edit this module")

    parsed_module.monsters = monsters
    parsed_module.monsters_count = len(monsters)
    await db.commit()

    return {"message": "Monsters updated successfully", "monsters_count": len(monsters)}


@router.put("/parsed/{module_id}/items")
async def update_module_items(
    module_id: str,
    items: list = Body(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """更新模组物品列表"""
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    parsed_module = result.scalar_one_or_none()

    if not parsed_module:
        raise HTTPException(status_code=404, detail="Module not found")

    if parsed_module.created_by != x_user_id:
        raise HTTPException(status_code=403, detail="Only the creator can edit this module")

    parsed_module.items = items
    parsed_module.items_count = len(items)
    await db.commit()

    return {"message": "Items updated successfully", "items_count": len(items)}


@router.post("/parsed/{module_id}/refresh-toc")
async def refresh_module_toc(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    重新提取模组TOC（从已有markdown重新生成，包含章节内容）
    不需要重新OCR，直接从raw_module_files读取markdown
    返回SSE流式进度
    """
    from app.domain.parsing import TocExtractor
    from app.services.ai_model_service import ai_model_service

    # 1. 查找 parsed_module
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    parsed_module = result.scalar_one_or_none()
    if not parsed_module:
        raise HTTPException(404, "模组不存在")

    if parsed_module.created_by != x_user_id:
        raise HTTPException(403, "无权限")

    # 2. 查找对应的 raw_module_file 获取 markdown
    if not parsed_module.source_file_id:
        raise HTTPException(400, "找不到源文件ID")

    try:
        source_file_id_int = int(parsed_module.source_file_id)
    except ValueError:
        raise HTTPException(400, f"无效的源文件ID: {parsed_module.source_file_id}")

    raw_result = await db.execute(
        select(RawModuleFile).where(RawModuleFile.id == source_file_id_int)
    )
    raw_file = raw_result.scalar_one_or_none()
    if not raw_file or not raw_file.markdown_content:
        raise HTTPException(400, "找不到markdown内容")

    advanced_config = await ai_model_service.get_config_for_usage(db, "module_refresh_toc")
    markdown_content = raw_file.markdown_content
    skip_llm = bool(getattr(raw_file, "headings_inferred", False))

    parsed_module_id = parsed_module.id

    async def generate_stream():
        try:
            toc_extractor = TocExtractor(None)  # 不需要 db

            # Step 1: 提取标题
            yield f"data: {json.dumps({'step': 'extract', 'message': '正在提取标题...', 'progress': 10}, ensure_ascii=False)}\n\n"
            headings = toc_extractor.extract_headings(markdown_content)
            if not headings:
                async with async_session_maker() as save_db:
                    result = await save_db.execute(
                        select(ParsedModule).where(ParsedModule.id == parsed_module_id)
                    )
                    pm = result.scalar_one()
                    pm.toc = []
                    pm.chapters = []
                    pm.chapters_count = 0
                    await save_db.commit()
                yield f"data: {json.dumps({'step': 'done', 'message': 'TOC刷新成功，共 0 个章节', 'chapters_count': 0}, ensure_ascii=False)}\n\n"
                return
            yield f"data: {json.dumps({'step': 'extract', 'message': f'提取到 {len(headings)} 个标题', 'progress': 20}, ensure_ascii=False)}\n\n"

            # Step 2: LLM 分析层级（如果 headings_inferred=True 则跳过）
            if skip_llm:
                yield f"data: {json.dumps({'step': 'llm_done', 'message': '标题层级已由 bbox 推断，跳过 LLM 分析', 'progress': 70}, ensure_ascii=False)}\n\n"
                # 仍然需要 group_by_chapters 来收集章节边界信息
                toc_extractor.group_by_chapters(headings, markdown_content)
            else:
                total = len(headings)
                llm_api_kwargs = dict(
                    api_url=advanced_config.api_url,
                    api_key=advanced_config.api_key,
                    model=advanced_config.model_name,
                )

                # 构建分组列表: [(label, headings_subset), ...]
                MAX_GROUP_SIZE = 400
                chapter_groups = toc_extractor.group_by_chapters(headings, markdown_content)
                if chapter_groups:
                    groups = []
                    for ch_title, ch_headings in chapter_groups:
                        short = ch_title[:25] + ('...' if len(ch_title) > 25 else '')
                        if len(ch_headings) > MAX_GROUP_SIZE:
                            # 过大的章节再拆分
                            for j in range(0, len(ch_headings), MAX_GROUP_SIZE):
                                sub = ch_headings[j:j+MAX_GROUP_SIZE]
                                groups.append((f"{short}-{j//MAX_GROUP_SIZE+1}（{len(sub)}个）", sub))
                        else:
                            groups.append((f"{short}（{len(ch_headings)}个）", ch_headings))
                    yield f"data: {json.dumps({'step': 'llm', 'message': f'检测到目录结构，按 {len(groups)} 个章节分组', 'progress': 25}, ensure_ascii=False)}\n\n"
                elif total > 300:
                    batch_size = 300
                    groups = []
                    for i in range(0, total, batch_size):
                        batch = headings[i:i+batch_size]
                        groups.append((f"第{i//batch_size+1}批（{len(batch)}个）", batch))
                    yield f"data: {json.dumps({'step': 'llm', 'message': f'{total} 个标题，分 {len(groups)} 批处理', 'progress': 25}, ensure_ascii=False)}\n\n"
                else:
                    groups = [(f"全部（{total}个）", headings)]

                # 并行调 LLM + 心跳
                num_groups = len(groups)
                llm_tasks = []
                for g_idx, (label, batch) in enumerate(groups):
                    task = asyncio.create_task(
                        toc_extractor.reorganize_with_llm(batch, **llm_api_kwargs)
                    )
                    llm_tasks.append((g_idx, label, task))

                yield f"data: {json.dumps({'step': 'llm', 'message': f'已启动 {num_groups} 组并行 LLM 分析', 'progress': 30}, ensure_ascii=False)}\n\n"

                # 心跳循环等待全部完成
                elapsed = 0
                while not all(t.done() for _, _, t in llm_tasks):
                    await asyncio.sleep(5)
                    elapsed += 5
                    done_count = sum(1 for _, _, t in llm_tasks if t.done())
                    progress = 25 + int(45 * done_count / num_groups)
                    yield f"data: {json.dumps({'step': 'llm', 'message': f'LLM 分析中 {done_count}/{num_groups} 组完成，已等待 {elapsed}s', 'progress': progress}, ensure_ascii=False)}\n\n"

                # 收集结果，失败的重试一次
                llm_success_count = 0
                llm_last_error = None
                retry_items = []
                for g_idx, label, task in llm_tasks:
                    _, batch_status = task.result()
                    if batch_status.get("llm_success"):
                        llm_success_count += 1
                    else:
                        llm_last_error = batch_status.get("llm_error") or "未知"
                        retry_items.append((g_idx, label, groups[g_idx][1]))

                # 对失败的组重试一次
                if retry_items:
                    yield f"data: {json.dumps({'step': 'llm', 'message': f'{len(retry_items)} 组失败，重试中...', 'progress': 68}, ensure_ascii=False)}\n\n"
                    retry_tasks = []
                    for g_idx, label, batch in retry_items:
                        t = asyncio.create_task(
                            toc_extractor.reorganize_with_llm(batch, **llm_api_kwargs)
                        )
                        retry_tasks.append((g_idx, label, t))
                    while not all(t.done() for _, _, t in retry_tasks):
                        await asyncio.sleep(5)
                        yield f": heartbeat\n\n"
                    for g_idx, label, task in retry_tasks:
                        _, batch_status = task.result()
                        if batch_status.get("llm_success"):
                            llm_success_count += 1

                if llm_success_count == num_groups:
                    llm_msg = f"LLM 分析完成（{num_groups} 组全部成功）"
                elif llm_success_count > 0:
                    llm_msg = f"LLM 部分完成（{llm_success_count}/{num_groups} 组成功，失败: {llm_last_error}）"
                else:
                    llm_msg = f"LLM 分析失败（{llm_last_error}），使用规则层级"
                yield f"data: {json.dumps({'step': 'llm_done', 'message': llm_msg, 'progress': 70}, ensure_ascii=False)}\n\n"

            # Step 3: 填充章节内容
            yield f"data: {json.dumps({'step': 'content', 'message': '填充章节内容...', 'progress': 80}, ensure_ascii=False)}\n\n"
            toc_extractor.fill_content(headings, markdown_content)

            # Step 4: 构建树 & 去重 & 保存（用独立 session，因为 Depends 的 session 在 StreamingResponse 中可能已关闭）
            yield f"data: {json.dumps({'step': 'save', 'message': '构建目录树并保存...', 'progress': 90}, ensure_ascii=False)}\n\n"
            toc_extractor.apply_contents_subsections(headings)
            toc_extractor.clamp_top_level(headings)
            toc_extractor.refine_numbered_hierarchy(headings)
            tree = toc_extractor.build_tree(headings)
            tree = toc_extractor.deduplicate_toc(tree)

            toc_data = [t.to_dict() for t in tree]
            async with async_session_maker() as save_db:
                result = await save_db.execute(
                    select(ParsedModule).where(ParsedModule.id == parsed_module_id)
                )
                pm = result.scalar_one()
                pm.toc = toc_data
                pm.chapters = toc_data
                pm.chapters_count = len(tree)
                await save_db.commit()

            yield f"data: {json.dumps({'step': 'done', 'message': f'TOC刷新成功，共 {len(tree)} 个章节', 'chapters_count': len(tree)}, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error(f"TOC刷新失败: {e}")
            yield f"data: {json.dumps({'step': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/parsed/{module_id}/translate")
async def translate_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    翻译模组TOC结构化数据（英文→中文）
    不翻译markdown原文，只翻译title和content，保留英文原文到title_en/content_en
    """
    parsed_module = await get_owned_module_with_toc(
        module_id=module_id,
        requester_id=x_user_id,
        db=db,
    )
    return build_module_translation_response(
        parsed_module_id=parsed_module.id,
        original_toc=parsed_module.toc or [],
    )


@router.post("/parsed/{module_id}/translate-toc")
async def translate_module_toc(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """翻译TOC（与/translate相同，保留此端点向后兼容）"""
    return await translate_module(module_id, x_user_id, db)


@router.post("/parsed/{module_id}/translate-chapter/{chapter_idx}")
async def translate_single_chapter(
    module_id: str,
    chapter_idx: int,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """翻译单个章节的title和content（英文→中文），保留英文到_en字段"""
    return await translate_single_module_chapter(
        module_id=module_id,
        chapter_idx=chapter_idx,
        requester_id=x_user_id,
        db=db,
    )


@router.put("/parsed/{module_id}/share")
async def toggle_module_share(
    module_id: str,
    is_shared: bool = Body(..., embed=True),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Toggle module share status (DB + JSON dual write)"""
    user_is_admin = await is_admin(x_user_id, db)

    # Update database
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()
    if db_module:
        if db_module.created_by != x_user_id and not user_is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the creator or admin can share this module"
            )
        db_module.is_shared = is_shared
        await db.commit()

    # Update JSON file (keep in sync)
    metadata = module_file_manager.load_parsed_metadata()
    for module in metadata:
        if module["id"] == module_id:
            if module.get("created_by") != x_user_id and not user_is_admin:
                if not db_module:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only the creator or admin can share this module"
                    )
            module["is_shared"] = is_shared
            module_file_manager.save_parsed_metadata(metadata)
            return {"message": "Share status updated successfully", "module": module}

    if db_module:
        return {"message": "Share status updated successfully", "module": {
            "id": db_module.module_id,
            "is_shared": is_shared,
        }}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Module '{module_id}' not found"
    )


@router.post("/parsed/{module_id}/embed")
async def embed_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Trigger embedding generation for a module (for RAG search)"""
    return await trigger_module_embedding(
        module_id=module_id,
        requester_id=x_user_id,
        db=db,
    )


@router.get("/parsed/{module_id}/embed/status")
async def get_embedding_status(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Get embedding status for a module"""
    return await get_module_embedding_status(module_id=module_id, db=db)


@router.delete("/parsed/{module_id}/embed")
async def delete_module_embeddings(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Delete all embeddings for a module"""
    return await delete_module_embedding_records(
        module_id=module_id,
        requester_id=x_user_id,
        db=db,
    )


@router.get("/parsed/shared/list", response_model=List[dict])
async def list_shared_modules(
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """List all shared modules with creator names"""
    from app.models.user import User

    # JOIN User table to get creator username
    result = await db.execute(
        select(ParsedModule, User.username)
        .outerjoin(User, ParsedModule.created_by == User.id)
        .where(ParsedModule.is_shared == True)
        .order_by(ParsedModule.parsed_date.desc())
    )
    rows = result.all()

    if rows:
        return [
            {
                "id": m.module_id,
                "title": m.title,
                "title_en": m.title_en,
                "description": m.description,
                "chapters_count": m.chapters_count or 0,
                "monsters_count": m.monsters_count or 0,
                "items_count": m.items_count or 0,
                "images_count": m.images_count or 0,
                "source_file_id": m.source_file_id,
                "data_file": m.data_file,
                "parsed_date": m.parsed_date.isoformat() if m.parsed_date else None,
                "created_by": m.created_by,
                "creator_name": username or m.created_by,
                "is_shared": True,
                "original_module_id": m.original_module_id
            }
            for m, username in rows
        ]

    # Fall back to JSON file
    metadata = module_file_manager.load_parsed_metadata()
    shared = [m for m in metadata if m.get("is_shared", False)]
    for m in shared:
        m.setdefault("creator_name", m.get("created_by", "unknown"))
    return shared


@router.post("/parsed/{module_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id)
):
    """Duplicate a shared module to user's own modules"""
    metadata = module_file_manager.load_parsed_metadata()

    # Find the source module
    source_module = None
    for m in metadata:
        if m["id"] == module_id:
            source_module = m
            break

    if not source_module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module '{module_id}' not found"
        )

    # Check if module is shared
    if not source_module.get("is_shared", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only shared modules can be duplicated"
        )

    # Create a new module (duplicate)
    new_module_id = str(uuid.uuid4())
    new_module = {
        "id": new_module_id,
        "title": f"{source_module['title']} (copy)",
        "title_en": f"{source_module['title_en']} (copy)",
        "description": source_module.get("description", ""),
        "chapters_count": source_module.get("chapters_count", 0),
        "monsters_count": source_module.get("monsters_count", 0),
        "items_count": source_module.get("items_count", 0),
        "images_count": source_module.get("images_count", 0),
        "source_file_id": source_module.get("source_file_id", ""),
        "parsed_date": datetime.now().isoformat(),
        "data_file": f"{new_module_id}.json",
        "is_shared": False,  # New copies are private by default
        "created_by": x_user_id,  # Bind to the user who duplicated it
        "original_module_id": module_id  # Track the original
    }

    # Copy the data file
    source_data_file = PARSED_MODULES_DIR / source_module.get("data_file", f"{module_id}.json")
    new_data_file = PARSED_MODULES_DIR / f"{new_module_id}.json"

    try:
        if source_data_file.exists():
            # Copy and load the source data
            with open(source_data_file, "r", encoding="utf-8") as f:
                source_data = json.load(f)

            # Save the copy
            with open(new_data_file, "w", encoding="utf-8") as f:
                json.dump(source_data, f, ensure_ascii=False, indent=2)
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Source module data file not found"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to duplicate module: {str(e)}"
        )

    # Add new module to metadata
    metadata.append(new_module)
    module_file_manager.save_parsed_metadata(metadata)

    return {
        "message": "Module duplicated successfully",
        "module_id": new_module_id,
        "module": new_module
    }


class ExtractRequest(BaseModel):
    chapter_titles: Optional[List[str]] = None


@router.post("/parsed/{module_id}/extract-monsters")
async def extract_monsters(
    module_id: str,
    req: Optional[ExtractRequest] = None,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Extract monsters from module chapters using LLM with SSE progress"""
    chapter_titles = req.chapter_titles if req else None
    await get_required_module(db, module_id)
    return build_monster_extraction_response(
        module_id=module_id,
        chapter_titles=chapter_titles,
    )


@router.post("/parsed/{module_id}/extract-items")
async def extract_items(
    module_id: str,
    req: Optional[ExtractRequest] = None,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Extract magic items from module chapters using LLM with SSE progress"""
    chapter_titles = req.chapter_titles if req else None
    await get_required_module(db, module_id)
    return build_item_extraction_response(
        module_id=module_id,
        chapter_titles=chapter_titles,
    )


@router.post("/parsed/{module_id}/reparse-monster/{monster_index}")
async def reparse_monster(
    module_id: str,
    monster_index: int,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Re-parse a single monster to update structured data using LLM"""
    from app.services.monster_item_extractor import monster_item_extractor

    # Check module exists
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if not db_module:
        raise HTTPException(status_code=404, detail="Module not found")

    monsters = db_module.monsters or []
    if monster_index < 0 or monster_index >= len(monsters):
        raise HTTPException(status_code=404, detail="Monster index out of range")

    monster = monsters[monster_index]

    # Pass TOC so reparse can find full text from chapter source
    toc = db_module.toc or []

    # Re-parse using extractor (two-step: find text from TOC, then numerify)
    reparsed = await monster_item_extractor.reparse_single_monster(db, monster, toc=toc)

    if reparsed:
        # Update in module
        from sqlalchemy.orm.attributes import flag_modified
        monsters[monster_index] = reparsed
        db_module.monsters = monsters
        flag_modified(db_module, "monsters")
        await db.commit()
        return {"monster": reparsed}
    else:
        raise HTTPException(status_code=500, detail="Failed to re-parse monster")


@router.post("/parsed/{module_id}/reparse-item/{item_index}")
async def reparse_item(
    module_id: str,
    item_index: int,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Re-parse a single item to update structured data using LLM"""
    from app.services.monster_item_extractor import monster_item_extractor

    # Check module exists
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if not db_module:
        raise HTTPException(status_code=404, detail="Module not found")

    items = db_module.items or []
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item index out of range")

    item = items[item_index]

    # Re-parse using extractor
    reparsed = await monster_item_extractor.reparse_single_item(db, item)

    if reparsed:
        # Update in module
        from sqlalchemy.orm.attributes import flag_modified
        items[item_index] = reparsed
        db_module.items = items
        flag_modified(db_module, "items")
        await db.commit()
        return {"item": reparsed}
    else:
        raise HTTPException(status_code=500, detail="Failed to re-parse item")


@router.post("/parsed/{module_id}/upload-missing-images")
async def upload_missing_images_to_oss(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Upload images missing OSS URLs to Aliyun OSS"""
    from app.domain.parsing.oss_storage import get_oss_storage

    # Get module
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()

    if not db_module:
        raise HTTPException(status_code=404, detail="Module not found")

    images = db_module.images or []
    oss = get_oss_storage()

    uploaded_count = 0
    failed_count = 0

    for i, img in enumerate(images):
        # Skip if already has OSS URL
        if img.get("oss_url") or img.get("thumbnail_url"):
            continue

        # Get base64 data
        base64_data = img.get("image_base64")
        if not base64_data:
            failed_count += 1
            continue

        # Upload to OSS
        image_id = img.get("image_id", f"img-{i}")
        result = await oss.upload_base64_image_async(base64_data, str(db_module.source_file_id), image_id)

        if result:
            oss_url, thumbnail_url = result
            img["oss_url"] = oss_url
            img["thumbnail_url"] = thumbnail_url
            img["image_base64"] = ""  # Clear base64 to save space
            uploaded_count += 1
        else:
            failed_count += 1

    # Update database - force SQLAlchemy to detect JSONB change
    from sqlalchemy.orm.attributes import flag_modified
    db_module.images = images
    flag_modified(db_module, "images")
    await db.commit()

    return {
        "status": "success",
        "uploaded": uploaded_count,
        "failed": failed_count,
        "total_images": len(images)
    }


@router.get("/parsed/{module_id}/export")
async def export_parsed_module(
    module_id: str,
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Export a parsed module as a downloadable JSON file."""
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    db_module = result.scalar_one_or_none()
    if not db_module:
        raise HTTPException(status_code=404, detail="Module not found")

    user_is_admin = await is_admin(x_user_id, db)
    if not can_access_module(
        created_by=db_module.created_by,
        requester_id=x_user_id,
        is_shared=bool(db_module.is_shared),
        is_admin=user_is_admin,
    ):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Get markdown from raw file
    markdown_content = None
    if db_module.source_file_id:
        try:
            raw_result = await db.execute(
                select(RawModuleFile).where(RawModuleFile.id == int(db_module.source_file_id))
            )
            raw_file = raw_result.scalar_one_or_none()
            if raw_file:
                markdown_content = raw_file.markdown_content
        except (ValueError, TypeError):
            pass

    export_data = build_export_payload(
        db_module=db_module,
        markdown_content=markdown_content,
    )
    content = dump_export_json(export_data)
    filename = build_export_filename(db_module.title)

    from urllib.parse import quote
    encoded_filename = quote(filename)

    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.post("/parsed/import", status_code=status.HTTP_201_CREATED)
async def import_parsed_module(
    file: UploadFile = File(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Import a module from an exported JSON file, skipping OCR/parsing."""
    raw_bytes = await file.read()
    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    if data.get("format") != "deepwood-module-v1":
        raise HTTPException(status_code=400, detail="Unsupported format: expected deepwood-module-v1")

    # Deduplicate title: if "冒险模组" exists, rename to "冒险模组 2", "冒险模组 3", etc.
    mod = data.get("module", {})
    base_title = mod.get("title", "Imported Module")
    existing = await db.execute(
        select(ParsedModule.title).where(
            ParsedModule.created_by == x_user_id,
            ParsedModule.title.like(f"{base_title}%"),
        )
    )
    existing_titles = {row[0] for row in existing.all()}
    title = deduplicate_import_title(base_title, existing_titles)

    module_id, raw_file, parsed_module = build_import_models(
        data=data,
        module_id=None,
        title=title,
        user_id=x_user_id,
        file_name=file.filename or "import.dw.json",
        raw_bytes=raw_bytes,
    )
    db.add(raw_file)
    await db.flush()
    parsed_module.source_file_id = str(raw_file.id)
    db.add(parsed_module)
    await db.commit()

    return {
        "message": "Module imported successfully",
        "module_id": module_id,
        "title": parsed_module.title,
    }


@router.post("/ai-assist")
async def ai_assist_content_generation(
    data: dict = Body(...),
    x_user_id: str = Depends(_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 辅助内容生成 - SSE 流式输出
    用于编辑器中的 / 命令，根据章节上下文和用户提示生成内容
    """
    from app.services.ai_service import AIService
    from app.services.ai_model_service import ai_model_service

    chapter_title = data.get("chapterTitle", "")
    chapter_title_en = data.get("chapterTitleEn", "")
    current_content = data.get("currentContent", "")
    user_prompt = data.get("userPrompt", "")

    if not user_prompt:
        raise HTTPException(status_code=400, detail="用户提示不能为空")

    system_prompt = """你是一位经验丰富的 D&D 5E 城主（DM），正在帮助用户创建冒险模组内容。

## 你的任务
根据用户的指令，为当前章节生成合适的内容。直接输出内容，不要输出解释或元信息。

## 创作原则
1. **具体生动**：用细节让场景栩栩如生，避免泛泛而谈
2. **符合 D&D 风格**：使用奇幻世界的语言和概念
3. **实用性**：生成的内容应该可以直接用于游戏
4. **简洁明了**：除非用户明确要求详细，否则保持内容精炼

## 内容类型指南
- **地点描述**：包括感官细节（看、听、闻）、氛围、有趣的细节
- **NPC**：外貌特征、说话方式、动机、秘密
- **遭遇**：类型（战斗/探索/社交）、可能的结果、戏剧性元素
- **物品/宝藏**：外观描述、特殊属性、背景故事
- **情节钩子**：引人入胜的开场、悬念、选择
- **对话**：符合角色性格、推动剧情、提供线索

## 格式要求
- 使用 Markdown 格式
- 对于 NPC，使用列表格式呈现关键信息
- 对于遭遇，使用清晰的结构（描述、可能的结果等）
- 保持段落简短，便于阅读"""

    context_parts = []
    if chapter_title:
        context_parts.append(f"**当前章节**：{chapter_title}")
        if chapter_title_en:
            context_parts.append(f"（{chapter_title_en}）")
    if current_content:
        truncated_content = current_content[-500:] if len(current_content) > 500 else current_content
        context_parts.append(f"\n**已有内容**：\n{truncated_content}\n")

    user_message = "\n".join(context_parts) + f"\n**请生成**：{user_prompt}"

    # 预获取 AI 配置（在 generator 外部，确保 DB session 可用）
    config = await ai_model_service.get_config_for_usage(db, "module_ai_assist")

    async def event_generator():
        try:
            async for chunk in AIService.generate_completion_stream(
                api_url=config.api_url,
                api_key=config.api_key,
                model=config.model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=1500,
                temperature=0.8,
            ):
                yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            import logging
            logging.error(f"AI assist generation failed: {e}")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
