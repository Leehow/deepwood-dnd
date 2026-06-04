"""Re-index all module embeddings at 1024 dimensions."""
import asyncio
import sys
import os
import logging

logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, select
from app.db.session import async_session_maker, engine
from app.services.module_embedding_service import ModuleEmbeddingService
from app.models.parsed_module import ParsedModule


async def main():
    async with async_session_maker() as db:
        result = await db.execute(
            select(ParsedModule.module_id, ParsedModule.toc, ParsedModule.chapters)
        )
        modules = result.fetchall()

    embeddable = [m.module_id for m in modules if (m.toc or m.chapters)]

    print(f"Found {len(embeddable)} module(s) to re-index at {ModuleEmbeddingService.EMBEDDING_DIM} dims", flush=True)

    for i, module_id in enumerate(embeddable):
        print(f"[{i+1}/{len(embeddable)}] {module_id}", flush=True)
        async with async_session_maker() as db:
            service = ModuleEmbeddingService(db)
            async def cb(msg, pct):
                print(f"  {pct}% {msg}", flush=True)
            try:
                r = await service.embed_module(module_id, progress_callback=cb)
                print(f"  OK stored={r.get('stored_count')} err={r.get('error_count')}", flush=True)
            except Exception as e:
                print(f"  FAIL: {e}", flush=True)

    async with async_session_maker() as db:
        result = await db.execute(text(
            "SELECT module_id, COUNT(*) cnt, vector_dims(embedding) dims "
            "FROM module_embeddings GROUP BY module_id, vector_dims(embedding) ORDER BY cnt DESC"
        ))
        rows = result.fetchall()
        print("=== Final ===", flush=True)
        for r in rows:
            print(f"  {r.module_id}: {r.cnt} @ {r.dims}d", flush=True)

    await engine.dispose()

asyncio.run(main())
