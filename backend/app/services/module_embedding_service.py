"""
Module Embedding Service for RAG-based module content search
Uses pgvector for similarity search with optional reranking
"""
import asyncio
import logging
import re
from typing import List, Optional, Dict, Any, Callable
from sqlalchemy import select, text, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_embedding import ModuleEmbedding
from app.models.parsed_module import ParsedModule
from app.models.ai_settings import AIModelConfig, ModelType

logger = logging.getLogger(__name__)

# 进度回调类型
ProgressCallback = Callable[[str, int], Any]


class ModuleEmbeddingService:
    """Service for embedding module content and performing vector similarity search"""

    CHUNK_SIZE = 800  # Characters per chunk
    CHUNK_OVERLAP = 100  # Overlap between chunks
    EMBEDDING_DIM = 1024  # text-embedding-v4 dimension
    BATCH_SIZE = 10  # Embedding API batch size

    # Rerank best practices: retrieve more, rerank to fewer
    RETRIEVAL_TOP_K = 100  # Initial vector search candidates
    RERANK_TOP_K = 10  # Final results after reranking

    def __init__(self, db: AsyncSession):
        self.db = db
        self._embedding_config: Optional[AIModelConfig] = None
        self._rerank_config: Optional[AIModelConfig] = None

    async def _get_embedding_config(self) -> Optional[AIModelConfig]:
        """Get EMBEDDING model configuration from database"""
        if self._embedding_config:
            return self._embedding_config

        result = await self.db.execute(
            select(AIModelConfig).where(AIModelConfig.model_type == ModelType.EMBEDDING)
        )
        self._embedding_config = result.scalar_one_or_none()
        return self._embedding_config

    async def _get_rerank_config(self) -> Optional[AIModelConfig]:
        """Get RERANK model configuration from database"""
        if self._rerank_config:
            return self._rerank_config

        result = await self.db.execute(
            select(AIModelConfig).where(AIModelConfig.model_type == ModelType.RERANK)
        )
        self._rerank_config = result.scalar_one_or_none()
        return self._rerank_config

    async def generate_embedding(
        self, text: str, dimensions: Optional[int] = None
    ) -> Optional[List[float]]:
        """Generate embedding vector for text using configured EMBEDDING model"""
        result = await self.generate_embeddings_batch([text], dimensions=dimensions)
        return result[0] if result else None

    async def generate_embeddings_batch(
        self, texts: List[str], dimensions: Optional[int] = None
    ) -> List[Optional[List[float]]]:
        """Generate embedding vectors for multiple texts in one API call.

        Args:
            texts: List of texts to embed
            dimensions: Override output dimensions (to match stored embeddings)
        """
        import httpx

        if not texts:
            return []

        config = await self._get_embedding_config()
        if not config or not config.api_url or not config.api_key:
            raise ValueError("EMBEDDING model not configured in AI settings")

        api_url = config.api_url.strip().rstrip("/")
        if not api_url.endswith("/embeddings"):
            api_url = f"{api_url}/embeddings"

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": config.model_name or "text-embedding-3-small",
            "input": texts  # 批量输入
        }
        if dimensions:
            payload["dimensions"] = dimensions

        async with httpx.AsyncClient(timeout=120.0) as client:  # 增加超时时间
            response = await client.post(api_url, headers=headers, json=payload)
            if response.status_code != 200:
                raise ValueError(f"Embedding API error: {response.status_code} - {response.text}")

            data = response.json()
            # API返回的data按index排序
            embeddings_data = sorted(data.get("data", []), key=lambda x: x.get("index", 0))
            return [item.get("embedding") for item in embeddings_data]

    async def rerank_documents(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_n: int = 8
    ) -> List[Dict[str, Any]]:
        """Rerank documents using Cross-Encoder model for better precision"""
        import httpx

        if not documents:
            return []

        config = await self._get_rerank_config()
        if not config or not config.api_url or not config.api_key:
            return documents[:top_n]

        api_url = config.api_url.strip().rstrip("/")
        is_dashscope = "dashscope" in api_url

        if not is_dashscope and not api_url.endswith("/rerank"):
            api_url = f"{api_url}/rerank"

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        doc_texts = [doc.get("content", "") for doc in documents]

        if is_dashscope:
            payload = {
                "model": config.model_name or "gte-rerank",
                "input": {
                    "query": query,
                    "documents": doc_texts,
                },
                "parameters": {
                    "top_n": min(top_n, len(documents)),
                    "return_documents": False,
                }
            }
        else:
            payload = {
                "model": config.model_name or "rerank-v1",
                "query": query,
                "documents": doc_texts,
                "top_n": min(top_n, len(documents)),
                "return_documents": False
            }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(api_url, headers=headers, json=payload)
                if response.status_code != 200:
                    logger.warning(f"Rerank API error: {response.status_code}")
                    return documents[:top_n]

                data = response.json()
                # DashScope wraps results in "output", standard format uses "results" directly
                results = data.get("output", data).get("results", [])

                reranked = []
                for result in results:
                    idx = result.get("index", 0)
                    score = result.get("relevance_score", 0)
                    if idx < len(documents):
                        doc = documents[idx].copy()
                        doc["rerank_score"] = score
                        doc["vector_similarity"] = doc.get("similarity", 0)
                        doc["similarity"] = score
                        reranked.append(doc)

                return reranked

        except Exception as e:
            logger.error(f"Rerank error: {e}")
            return documents[:top_n]

    def _chunk_text(
        self,
        text: str,
        chapter_title: str,
        chapter_path: str
    ) -> List[Dict[str, Any]]:
        """Split text into overlapping chunks for embedding"""
        # Clean the text
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = text.strip()

        if not text:
            return []

        # 小章节完整保留
        if len(text) <= self.CHUNK_SIZE:
            return [{
                "content": text,
                "chapter_title": chapter_title,
                "chapter_path": chapter_path,
                "chunk_index": 0
            }]

        chunks = []
        start = 0
        chunk_index = 0

        while start < len(text):
            end = start + self.CHUNK_SIZE

            # Try to break at paragraph or sentence boundary
            if end < len(text):
                para_break = text.rfind('\n\n', start, end)
                if para_break > start + self.CHUNK_SIZE // 2:
                    end = para_break + 2
                else:
                    sentence_break = max(
                        text.rfind('。', start, end),
                        text.rfind('.', start, end),
                        text.rfind('！', start, end),
                        text.rfind('？', start, end)
                    )
                    if sentence_break > start + self.CHUNK_SIZE // 2:
                        end = sentence_break + 1

            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "content": chunk_text,
                    "chapter_title": chapter_title,
                    "chapter_path": chapter_path,
                    "chunk_index": chunk_index
                })
                chunk_index += 1

            start = end - self.CHUNK_OVERLAP

        return chunks

    def _extract_chapters_recursive(
        self,
        toc: List[Dict[str, Any]],
        parent_path: str = ""
    ) -> List[Dict[str, Any]]:
        """Recursively extract all chapters with their paths"""
        chapters = []

        for item in toc:
            title = item.get('title', '')
            content = item.get('content', '')
            children = item.get('children', [])

            current_path = f"{parent_path}/{title}" if parent_path else title

            if content:
                chapters.append({
                    "title": title,
                    "path": current_path,
                    "content": content
                })

            if children:
                chapters.extend(self._extract_chapters_recursive(children, current_path))

        return chapters

    async def _embed_and_store_chunks(
        self,
        module_id: str,
        all_chunks: List[Dict[str, Any]],
        progress_callback: Optional[ProgressCallback] = None,
        progress_base: int = 15,
    ) -> Dict[str, int]:
        """Generate embeddings for chunks and store them in DB.

        Returns:
            Dict with stored_count and error_count
        """
        total_chunks = len(all_chunks)
        stored_count = 0
        error_count = 0
        API_BATCH = self.BATCH_SIZE  # Embedding API limit per call
        DB_COMMIT_EVERY = 500  # Commit to DB every N chunks

        for batch_start in range(0, total_chunks, API_BATCH):
            batch_end = min(batch_start + API_BATCH, total_chunks)
            batch_chunks = all_chunks[batch_start:batch_end]

            try:
                await asyncio.sleep(0)

                texts = [chunk["content"] for chunk in batch_chunks]
                try:
                    embeddings = await self.generate_embeddings_batch(
                        texts, dimensions=self.EMBEDDING_DIM
                    )
                except Exception as batch_error:
                    logger.warning(f"Batch embedding failed, falling back to single: {batch_error}")
                    embeddings = []
                    for t in texts:
                        try:
                            emb = await self.generate_embedding(
                                t, dimensions=self.EMBEDDING_DIM
                            )
                            embeddings.append(emb)
                            await asyncio.sleep(0.05)
                        except Exception as e:
                            logger.error(f"Single embedding failed: {e}")
                            embeddings.append(None)

                for chunk, embedding in zip(batch_chunks, embeddings):
                    if embedding:
                        self.db.add(ModuleEmbedding(
                            module_id=module_id,
                            chapter_title=chunk["chapter_title"],
                            chapter_path=chunk["chapter_path"],
                            chunk_index=chunk["chunk_index"],
                            content=chunk["content"],
                            embedding=embedding,
                        ))
                        stored_count += 1

                # Commit periodically, not every API call
                if stored_count % DB_COMMIT_EVERY < API_BATCH:
                    await self.db.commit()

                if progress_callback and stored_count % 100 < API_BATCH:
                    progress = progress_base + int((batch_end / total_chunks) * (95 - progress_base))
                    await progress_callback(f"已处理 {stored_count}/{total_chunks}...", progress)

            except Exception as e:
                logger.error(f"Error embedding batch {batch_start}-{batch_end}: {e}")
                error_count += len(batch_chunks)
                if error_count > total_chunks * 0.1:
                    raise RuntimeError(f"Too many embedding errors: {e}")

        await self.db.commit()
        return {"stored_count": stored_count, "error_count": error_count}

    async def embed_module(
        self,
        module_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Embed all content from a parsed module.

        Args:
            module_id: The parsed_module.module_id
            progress_callback: Optional callback(message, percent)

        Returns:
            Dict with embedding results
        """
        # Get module
        result = await self.db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = result.scalar_one_or_none()

        if not module:
            raise ValueError(f"Module not found: {module_id}")

        # Get TOC data (fallback to chapters)
        toc_data = module.toc or module.chapters or []
        if not toc_data:
            return {"status": "skipped", "message": "No content to embed"}

        # Delete existing embeddings
        await self.delete_module_embeddings(module_id)

        if progress_callback:
            await progress_callback("提取章节内容...", 5)

        # Extract all chapters
        chapters = self._extract_chapters_recursive(toc_data)
        logger.info(f"Extracted {len(chapters)} chapters from module {module_id}")

        if progress_callback:
            await progress_callback(f"分割 {len(chapters)} 个章节...", 10)

        # Chunk all chapters
        all_chunks = []
        for chapter in chapters:
            chunks = self._chunk_text(
                chapter["content"],
                chapter["title"],
                chapter["path"]
            )
            all_chunks.extend(chunks)

        total_chunks = len(all_chunks)
        logger.info(f"Created {total_chunks} chunks for module {module_id}")

        if total_chunks == 0:
            return {"status": "skipped", "message": "No content chunks created"}

        if progress_callback:
            await progress_callback(f"生成 {total_chunks} 个向量...", 15)

        counts = await self._embed_and_store_chunks(
            module_id, all_chunks, progress_callback, progress_base=15
        )

        if progress_callback:
            await progress_callback("向量化完成!", 100)

        return {
            "status": "success",
            "module_id": module_id,
            "chapters_count": len(chapters),
            "chunks_count": total_chunks,
            **counts,
        }

    async def embed_chapters(
        self,
        module_id: str,
        chapters: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Embed flat chapter list (for custom modules).

        Args:
            module_id: The custom module's module_id
            chapters: List of {"id", "title", "content", "order", ...}

        Returns:
            Dict with embedding results
        """
        # Filter chapters with actual content
        valid = [ch for ch in chapters if ch.get("content", "").strip()]
        if not valid:
            return {"status": "skipped", "message": "No content to embed"}

        # Delete old embeddings
        await self.delete_module_embeddings(module_id)

        # Chunk each chapter
        all_chunks = []
        for ch in valid:
            title = ch.get("title", "未命名章节")
            chunks = self._chunk_text(ch["content"], title, title)
            all_chunks.extend(chunks)

        if not all_chunks:
            return {"status": "skipped", "message": "No content chunks created"}

        logger.info(f"[CustomModule] {module_id}: {len(valid)} chapters -> {len(all_chunks)} chunks")

        counts = await self._embed_and_store_chunks(module_id, all_chunks)

        return {
            "status": "success",
            "module_id": module_id,
            "chapters_count": len(valid),
            "chunks_count": len(all_chunks),
            **counts,
        }

    async def search_module_content(
        self,
        module_id: str,
        query: str,
        top_k: int = 8,
        similarity_threshold: float = 0.3,
        use_rerank: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Search module content using vector similarity + optional reranking.

        Args:
            module_id: The module to search in
            query: User's question
            top_k: Number of final results
            similarity_threshold: Minimum similarity score
            use_rerank: Whether to use reranking

        Returns:
            List of matching chunks with content, chapter info, similarity
        """
        # Check if module is embedded and get stored dimensions
        dim_result = await self.db.execute(
            text("SELECT vector_dims(embedding) FROM module_embeddings WHERE module_id = :mid LIMIT 1"),
            {"mid": module_id}
        )
        dim_row = dim_result.fetchone()
        if not dim_row:
            return []  # Module not embedded
        stored_dims = dim_row[0]

        # Only pass dimensions if the value is supported by the API
        VALID_DIMS = {64, 128, 256, 512, 768, 1024, 1536, 2048, 3072}
        req_dims = stored_dims if stored_dims in VALID_DIMS else None
        query_embedding = await self.generate_embedding(query, dimensions=req_dims)
        if not query_embedding:
            return []

        # If generated dims don't match stored dims, vector search is impossible
        if len(query_embedding) != stored_dims:
            logger.warning(
                f"Embedding dimension mismatch: query={len(query_embedding)}, stored={stored_dims}. "
                "Skipping vector search. Consider re-embedding the module."
            )
            return []

        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        # Retrieve candidates
        retrieval_limit = self.RETRIEVAL_TOP_K if use_rerank else top_k

        query_str = text(f"""
            SELECT
                id,
                chapter_title,
                chapter_path,
                chunk_index,
                content,
                1 - (embedding <=> '{embedding_str}'::vector) as similarity
            FROM module_embeddings
            WHERE module_id = :module_id
              AND 1 - (embedding <=> '{embedding_str}'::vector) > :threshold
            ORDER BY embedding <=> '{embedding_str}'::vector
            LIMIT :limit
        """)

        result = await self.db.execute(
            query_str,
            {
                "module_id": module_id,
                "threshold": similarity_threshold,
                "limit": retrieval_limit
            }
        )

        rows = result.fetchall()
        candidates = [
            {
                "id": row.id,
                "content": row.content,
                "chapter_title": row.chapter_title,
                "chapter_path": row.chapter_path,
                "chunk_index": row.chunk_index,
                "similarity": float(row.similarity)
            }
            for row in rows
        ]

        if not candidates:
            return []

        # Rerank if enabled
        if use_rerank and len(candidates) > top_k:
            return await self.rerank_documents(query, candidates, top_n=top_k)
        else:
            return candidates[:top_k]

    async def is_module_embedded(self, module_id: str) -> bool:
        """Check if a module has been embedded"""
        result = await self.db.execute(
            select(ModuleEmbedding).where(ModuleEmbedding.module_id == module_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def get_embedding_stats(self, module_id: str) -> Dict[str, Any]:
        """Get embedding statistics for a module"""
        result = await self.db.execute(
            text("""
                SELECT COUNT(*) as chunk_count,
                       COUNT(DISTINCT chapter_title) as chapter_count,
                       MIN(created_at) as created_at
                FROM module_embeddings
                WHERE module_id = :module_id
            """),
            {"module_id": module_id}
        )
        row = result.fetchone()
        if row and row.chunk_count > 0:
            return {
                "embedded": True,
                "chunk_count": row.chunk_count,
                "chapter_count": row.chapter_count,
                "created_at": row.created_at.isoformat() if row.created_at else None
            }
        return {"embedded": False}

    async def delete_module_embeddings(self, module_id: str) -> int:
        """Delete all embeddings for a module"""
        result = await self.db.execute(
            delete(ModuleEmbedding).where(ModuleEmbedding.module_id == module_id)
        )
        await self.db.commit()
        return result.rowcount
