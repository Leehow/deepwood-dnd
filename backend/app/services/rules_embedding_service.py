"""
Rules Embedding Service for RAG-based D&D rules Q&A
Uses Mistral OCR for PDF extraction and pgvector for similarity search
"""
import re
import httpx
from pathlib import Path
from typing import List, Optional, Dict, Any
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rules_embedding import RulesEmbedding
from app.models.ai_settings import AIModelConfig, ModelType
from app.services.mistral_ocr_service import get_ocr_service
from app.services.module_parse_flow_service import normalize_ocr_conversion_result
from app.core.config import settings


class RulesEmbeddingService:
    """Service for indexing PDF books and performing vector similarity search"""

    CHUNK_SIZE = 800  # Characters per chunk
    CHUNK_OVERLAP = 100  # Overlap between chunks
    EMBEDDING_DIM = 1024  # text-embedding-v4 dimension

    # Rerank best practices: retrieve more, rerank to fewer
    RETRIEVAL_TOP_K = 50  # Initial vector search candidates
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

    async def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding vector for text using configured EMBEDDING model"""
        config = await self._get_embedding_config()
        if not config or not config.api_url or not config.api_key:
            raise ValueError("EMBEDDING model not configured in AI settings")

        api_url = config.api_url.strip().rstrip("/")
        # Only append /embeddings if not already present
        if not api_url.endswith("/embeddings"):
            api_url = f"{api_url}/embeddings"

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": config.model_name or "text-embedding-3-small",
            "input": text
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(api_url, headers=headers, json=payload)
            if response.status_code != 200:
                raise ValueError(f"Embedding API error: {response.status_code} - {response.text}")

            data = response.json()
            embedding = data.get("data", [{}])[0].get("embedding")
            return embedding

    async def rerank_documents(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_n: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Rerank documents using Cross-Encoder model for better precision.

        Best practice: Vector search retrieves ~50 candidates (recall-oriented),
        then reranker selects top 5-10 (precision-oriented).

        Args:
            query: User's search query
            documents: List of candidate documents from vector search
            top_n: Number of top results to return after reranking

        Returns:
            Reranked list of documents with updated relevance scores
        """
        if not documents:
            return []

        config = await self._get_rerank_config()
        if not config or not config.api_url or not config.api_key:
            # Fallback: return original order if rerank not configured
            return documents[:top_n]

        api_url = config.api_url.strip().rstrip("/")
        is_dashscope = "dashscope" in api_url

        if not is_dashscope and not api_url.endswith("/rerank"):
            api_url = f"{api_url}/rerank"

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        # Prepare documents for reranking (extract content text)
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
                    # Fallback on error
                    print(f"Rerank API error: {response.status_code} - {response.text}")
                    return documents[:top_n]

                data = response.json()
                # DashScope wraps results in "output", standard format uses "results" directly
                results = data.get("output", data).get("results", [])

                # Reorder documents based on reranker scores
                reranked = []
                for result in results:
                    idx = result.get("index", 0)
                    score = result.get("relevance_score", 0)
                    if idx < len(documents):
                        doc = documents[idx].copy()
                        doc["rerank_score"] = score
                        # Keep original similarity for reference
                        doc["vector_similarity"] = doc.get("similarity", 0)
                        doc["similarity"] = score  # Use rerank score as primary
                        reranked.append(doc)

                return reranked

        except Exception as e:
            print(f"Rerank error: {e}")
            return documents[:top_n]

    def _chunk_text(self, text: str, source: str, page_number: Optional[int] = None) -> List[Dict[str, Any]]:
        """Split text into overlapping chunks for embedding"""
        # Clean the text
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = text.strip()

        if not text:
            return []

        chunks = []
        start = 0
        chunk_index = 0

        while start < len(text):
            end = start + self.CHUNK_SIZE

            # Try to break at sentence or paragraph boundary
            if end < len(text):
                # Look for paragraph break
                para_break = text.rfind('\n\n', start, end)
                if para_break > start + self.CHUNK_SIZE // 2:
                    end = para_break + 2
                else:
                    # Look for sentence break
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
                    "source": source,
                    "page_number": page_number,
                    "chunk_index": chunk_index
                })
                chunk_index += 1

            start = end - self.CHUNK_OVERLAP

        return chunks

    async def index_pdf_book(
        self,
        pdf_path: str,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Index a PDF book: extract text via Mistral OCR, chunk, embed, and store

        Args:
            pdf_path: Path to the PDF file
            progress_callback: Optional async callback(message, percent)

        Returns:
            Dict with indexing results
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        source_name = pdf_path.stem  # e.g., "DND_5E_玩家手册CN"

        # Check if already indexed
        existing = await self.db.execute(
            select(RulesEmbedding).where(RulesEmbedding.source == source_name).limit(1)
        )
        if existing.scalar_one_or_none():
            return {"status": "skipped", "message": f"{source_name} already indexed"}

        if progress_callback:
            await progress_callback(f"Extracting text from {pdf_path.name}...", 5)

        # Use the configured OCR provider to extract text.
        ocr_service = get_ocr_service()
        output_dir = Path(settings.UPLOAD_DIR) / "rules_ocr" / source_name
        output_dir.mkdir(parents=True, exist_ok=True)

        ocr_result = normalize_ocr_conversion_result(
            await ocr_service.convert_pdf_to_markdown(
                pdf_path,
                output_dir,
                progress_callback=progress_callback
            )
        )

        markdown_content = ocr_result.get("markdown_content", "")
        if not markdown_content:
            raise ValueError("No text extracted from PDF")

        if progress_callback:
            await progress_callback("Chunking text...", 50)

        # Split by pages (separated by ---)
        pages = markdown_content.split("\n\n---\n\n")
        all_chunks = []

        for page_num, page_content in enumerate(pages, 1):
            page_chunks = self._chunk_text(page_content, source_name, page_num)
            all_chunks.extend(page_chunks)

        if progress_callback:
            await progress_callback(f"Generating embeddings for {len(all_chunks)} chunks...", 55)

        # Generate embeddings and store in batches
        total_chunks = len(all_chunks)
        stored_count = 0

        for i, chunk in enumerate(all_chunks):
            try:
                embedding = await self.generate_embedding(chunk["content"])
                if embedding:
                    rules_embedding = RulesEmbedding(
                        source=chunk["source"],
                        page_number=chunk["page_number"],
                        chunk_index=chunk["chunk_index"],
                        content=chunk["content"],
                        embedding=embedding
                    )
                    self.db.add(rules_embedding)
                    stored_count += 1

                # Commit in batches to avoid memory issues
                if stored_count % 50 == 0:
                    await self.db.commit()
                    if progress_callback:
                        progress = 55 + int((i / total_chunks) * 40)
                        await progress_callback(f"Stored {stored_count}/{total_chunks} chunks...", progress)

            except Exception as e:
                print(f"Error embedding chunk {i}: {e}")
                continue

        await self.db.commit()

        if progress_callback:
            await progress_callback("Indexing complete!", 100)

        return {
            "status": "success",
            "source": source_name,
            "pages_count": len(pages),
            "chunks_count": total_chunks,
            "stored_count": stored_count
        }

    async def search_similar_rules(
        self,
        query: str,
        top_k: int = 5,
        similarity_threshold: float = 0.3,
        use_rerank: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Search for rules using vector similarity + optional reranking.

        Funnel mode (best practice):
        1. Vector search retrieves RETRIEVAL_TOP_K candidates (recall-oriented)
        2. Reranker selects top_k most relevant (precision-oriented)

        Args:
            query: User's question about rules
            top_k: Number of final results to return
            similarity_threshold: Minimum vector similarity score (0-1)
            use_rerank: Whether to use reranking (default True)

        Returns:
            List of matching rules with content, source, page_number, similarity
        """
        # Generate query embedding
        query_embedding = await self.generate_embedding(query)
        if not query_embedding:
            return []

        # Convert embedding list to PostgreSQL vector format
        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        # Step 1: Retrieve more candidates for reranking (funnel approach)
        # If reranking, get more candidates; otherwise just get top_k
        retrieval_limit = self.RETRIEVAL_TOP_K if use_rerank else top_k

        # Use pgvector's cosine similarity search
        query_str = text(f"""
            SELECT
                id,
                source,
                page_number,
                content,
                1 - (embedding <=> '{embedding_str}'::vector) as similarity
            FROM rules_embeddings
            WHERE 1 - (embedding <=> '{embedding_str}'::vector) > :threshold
            ORDER BY embedding <=> '{embedding_str}'::vector
            LIMIT :limit
        """)

        result = await self.db.execute(
            query_str,
            {
                "threshold": similarity_threshold,
                "limit": retrieval_limit
            }
        )

        rows = result.fetchall()
        candidates = [
            {
                "id": row.id,
                "content": row.content,
                "source": row.source,
                "page_number": row.page_number,
                "similarity": float(row.similarity)
            }
            for row in rows
        ]

        if not candidates:
            return []

        # Step 2: Rerank candidates if enabled
        if use_rerank and len(candidates) > top_k:
            reranked = await self.rerank_documents(query, candidates, top_n=top_k)
            return reranked
        else:
            return candidates[:top_k]

    async def get_indexed_sources(self) -> List[Dict[str, Any]]:
        """Get list of indexed PDF sources with chunk counts"""
        result = await self.db.execute(
            text("""
                SELECT source, COUNT(*) as chunk_count, MIN(created_at) as indexed_at
                FROM rules_embeddings
                GROUP BY source
                ORDER BY indexed_at DESC
            """)
        )
        rows = result.fetchall()
        return [
            {
                "source": row.source,
                "chunk_count": row.chunk_count,
                "indexed_at": row.indexed_at.isoformat() if row.indexed_at else None
            }
            for row in rows
        ]

    async def delete_source(self, source: str) -> int:
        """Delete all embeddings for a source, returns deleted count"""
        result = await self.db.execute(
            text("DELETE FROM rules_embeddings WHERE source = :source RETURNING id"),
            {"source": source}
        )
        await self.db.commit()
        return len(result.fetchall())

    def _json_item_to_text(self, item: Dict[str, Any], item_type: str) -> str:
        """Convert a JSON rule item to searchable text"""
        parts = []
        name = item.get("name", item.get("id", ""))
        name_en = item.get("nameEn", "")

        if name:
            parts.append(f"【{name}】" + (f" ({name_en})" if name_en else ""))

        # Common fields
        if item.get("description"):
            parts.append(item["description"])
        if item.get("descriptionEn"):
            parts.append(item["descriptionEn"])

        # Disease/Poison specific
        if item.get("transmission"):
            parts.append(f"传播方式: {item['transmission']}")
        if item.get("incubation"):
            parts.append(f"潜伏期: {item['incubation']}")
        if item.get("dc"):
            parts.append(f"豁免DC: {item['dc']}")
        if item.get("cure"):
            parts.append(f"治愈方法: {item['cure']}")
        if item.get("symptoms"):
            parts.append(f"症状: {', '.join(item['symptoms'])}")
        if item.get("effects"):
            for eff in item["effects"]:
                if isinstance(eff, dict):
                    parts.append(f"- {eff.get('trigger', '')}: {eff.get('effect', '')}")
                else:
                    parts.append(f"- {eff}")

        # Poison specific
        if item.get("price"):
            parts.append(f"价格: {item['price']}")
        if item.get("poisonType"):
            parts.append(f"毒素类型: {item['poisonType']}")

        # NPC specific
        if item.get("cr"):
            parts.append(f"挑战等级: {item['cr']}")
        if item.get("ac"):
            parts.append(f"护甲等级: {item['ac']}")
        if item.get("hp"):
            parts.append(f"生命值: {item['hp']}")
        if item.get("abilities"):
            for ab in item["abilities"]:
                if isinstance(ab, dict):
                    parts.append(f"特性 - {ab.get('name', '')}: {ab.get('description', '')}")
        if item.get("actions"):
            for act in item["actions"]:
                if isinstance(act, dict):
                    parts.append(f"动作 - {act.get('name', '')}: {act.get('description', '')}")

        # Encounter table specific
        if item.get("encounters"):
            for enc in item["encounters"]:
                if isinstance(enc, dict):
                    cr = enc.get("cr", "")
                    monsters = enc.get("monsters", [])
                    if monsters:
                        parts.append(f"CR {cr}: {', '.join(monsters)}")

        return "\n".join(parts)

    async def index_json_rules(
        self,
        json_path: str,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Index a JSON rules file: extract items, generate embeddings, and store

        Args:
            json_path: Path to the JSON file
            progress_callback: Optional async callback(message, percent)
        """
        import json as json_module
        json_path = Path(json_path)
        if not json_path.exists():
            raise FileNotFoundError(f"JSON not found: {json_path}")

        source_name = f"rules_{json_path.stem}"

        # Check if already indexed
        existing = await self.db.execute(
            select(RulesEmbedding).where(RulesEmbedding.source == source_name).limit(1)
        )
        if existing.scalar_one_or_none():
            return {"status": "skipped", "message": f"{source_name} already indexed"}

        if progress_callback:
            await progress_callback(f"Loading {json_path.name}...", 5)

        with open(json_path, "r", encoding="utf-8") as f:
            data = json_module.load(f)

        # Extract items based on JSON structure
        items = []
        item_type = json_path.stem

        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            # Try common container keys
            for key in ["diseases", "poisons", "npcs", "spells", "monsters",
                       "items", "classes", "races", "backgrounds", "conditions",
                       "abilities", "skills", "gods", "planes", "creatures"]:
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
            # Handle environments (encounter-tables)
            if "environments" in data and isinstance(data["environments"], dict):
                items = list(data["environments"].values())
            # If still empty, treat entire dict as single item or extract all values
            if not items and data:
                if "overview" in data:
                    items.append({"name": "概述", "description": data["overview"].get("description", "")})
                for k, v in data.items():
                    if isinstance(v, list):
                        items.extend(v)

        if not items:
            return {"status": "empty", "message": f"No items found in {json_path.name}"}

        if progress_callback:
            await progress_callback(f"Processing {len(items)} items...", 20)

        stored_count = 0
        total = len(items)

        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue

            text_content = self._json_item_to_text(item, item_type)
            if not text_content or len(text_content) < 10:
                continue

            try:
                embedding = await self.generate_embedding(text_content)
                if embedding:
                    rules_embedding = RulesEmbedding(
                        source=source_name,
                        page_number=i + 1,
                        chunk_index=0,
                        content=text_content,
                        embedding=embedding
                    )
                    self.db.add(rules_embedding)
                    stored_count += 1

                    if stored_count % 20 == 0:
                        await self.db.commit()
                        if progress_callback:
                            progress = 20 + int((i / total) * 75)
                            await progress_callback(f"Indexed {stored_count}/{total}...", progress)
            except Exception as e:
                print(f"Error embedding item {i}: {e}")
                continue

        await self.db.commit()

        if progress_callback:
            await progress_callback("Indexing complete!", 100)

        return {
            "status": "success",
            "source": source_name,
            "items_count": total,
            "stored_count": stored_count
        }
