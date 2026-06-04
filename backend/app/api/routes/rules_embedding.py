"""
Rules Embedding API routes for managing PDF indexing
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from pathlib import Path
from pydantic import BaseModel

from app.db.session import get_db
from app.services.rules_embedding_service import RulesEmbeddingService
from app.core.config import settings
from app.utils.rules_cache import RULES_BASE_PATH, PROJECT_ROOT

router = APIRouter(prefix="/rules-embedding", tags=["Rules Embedding"])


class IndexSourceRequest(BaseModel):
    """Request to index a PDF source"""
    pdf_path: str  # Relative path from project root


class IndexSourceResponse(BaseModel):
    """Response for index operation"""
    status: str
    source: str = None
    message: str = None
    pages_count: int = None
    chunks_count: int = None
    stored_count: int = None


class IndexedSourceInfo(BaseModel):
    """Info about an indexed source"""
    source: str
    chunk_count: int
    indexed_at: str = None


# Track indexing progress in memory (simple solution)
_indexing_progress = {}


@router.get("/sources", response_model=List[IndexedSourceInfo])
async def list_indexed_sources(db: AsyncSession = Depends(get_db)):
    """List all indexed PDF sources"""
    service = RulesEmbeddingService(db)
    sources = await service.get_indexed_sources()
    return [IndexedSourceInfo(**s) for s in sources]


@router.post("/index", response_model=IndexSourceResponse)
async def index_pdf_source(
    request: IndexSourceRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Index a PDF book for RAG search

    The PDF will be processed using Mistral OCR, chunked, and embedded.
    This is a long-running operation that runs in the background.
    """
    # Resolve path
    pdf_path = Path(request.pdf_path)
    if not pdf_path.is_absolute():
        # Try relative to project root
        project_root = PROJECT_ROOT
        pdf_path = project_root / request.pdf_path

    if not pdf_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PDF file not found: {request.pdf_path}"
        )

    source_name = pdf_path.stem
    _indexing_progress[source_name] = {"status": "starting", "progress": 0}

    async def progress_callback(message: str, percent: int):
        _indexing_progress[source_name] = {"status": message, "progress": percent}

    try:
        service = RulesEmbeddingService(db)
        result = await service.index_pdf_book(str(pdf_path), progress_callback)

        _indexing_progress[source_name] = {"status": "completed", "progress": 100}

        return IndexSourceResponse(
            status=result["status"],
            source=result.get("source"),
            message=result.get("message"),
            pages_count=result.get("pages_count"),
            chunks_count=result.get("chunks_count"),
            stored_count=result.get("stored_count")
        )
    except Exception as e:
        _indexing_progress[source_name] = {"status": f"error: {str(e)}", "progress": -1}
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Indexing failed: {str(e)}"
        )


@router.get("/progress/{source_name}")
async def get_indexing_progress(source_name: str):
    """Get progress of ongoing indexing operation"""
    if source_name in _indexing_progress:
        return _indexing_progress[source_name]
    return {"status": "unknown", "progress": -1}


@router.delete("/sources/{source_name}")
async def delete_indexed_source(
    source_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete all embeddings for a source"""
    service = RulesEmbeddingService(db)
    deleted_count = await service.delete_source(source_name)

    if deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source not found: {source_name}"
        )

    return {"status": "success", "deleted_count": deleted_count}


@router.get("/available-books")
async def list_available_books():
    """List available PDF books that can be indexed"""
    books_dir = PROJECT_ROOT / "docs" / "books"
    available = []

    if books_dir.exists():
        for pdf_file in books_dir.glob("*.pdf"):
            available.append({
                "name": pdf_file.stem,
                "path": f"docs/books/{pdf_file.name}",
                "size_mb": round(pdf_file.stat().st_size / (1024 * 1024), 2)
            })

    return {"books": available}


class IndexJsonRequest(BaseModel):
    """Request to index JSON rules files"""
    files: List[str] = None  # Specific files to index, or None for all


@router.post("/index-json")
async def index_json_rules(
    request: IndexJsonRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Index JSON rules files for RAG search

    If no files specified, indexes all standard rules JSON files.
    """
    # Default rules files to index
    rules_dir = RULES_BASE_PATH

    default_files = [
        "diseases.json",
        "poisons.json",
        "npc-templates.json",
        "encounter-tables.json",
        "conditions.json",
        "creatures.json",
        "gods.json",
        "planes.json",
        "skills.json",
        "abilities.json",
    ]

    files_to_index = request.files if request and request.files else default_files
    results = []

    service = RulesEmbeddingService(db)

    for filename in files_to_index:
        json_path = rules_dir / filename
        if not json_path.exists():
            results.append({"file": filename, "status": "not_found"})
            continue

        try:
            result = await service.index_json_rules(str(json_path))
            results.append({"file": filename, **result})
        except Exception as e:
            results.append({"file": filename, "status": "error", "message": str(e)})

    return {
        "status": "completed",
        "results": results,
        "total_files": len(files_to_index),
        "successful": sum(1 for r in results if r.get("status") == "success")
    }


@router.get("/available-json")
async def list_available_json():
    """List available JSON rules files that can be indexed"""
    rules_dir = RULES_BASE_PATH
    available = []

    if rules_dir.exists():
        for json_file in rules_dir.glob("*.json"):
            available.append({
                "name": json_file.stem,
                "path": f"frontend/app/data/rules/{json_file.name}",
                "size_kb": round(json_file.stat().st_size / 1024, 2)
            })

    return {"files": available}
