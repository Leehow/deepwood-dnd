from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Awaitable, Callable
import inspect

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chapter_splitter import chapter_splitter
from app.services.module_image_classifier import module_image_classifier
from app.services.module_parse_flow_service import (
    detect_markdown_language,
    normalize_ocr_conversion_result,
    persist_ocr_snapshot,
    persist_parsed_module_output,
    persist_translated_markdown,
    resolve_ocr_provider,
    translate_markdown_by_language,
)
from app.services.module_parse_task_service import (
    build_resume_progress_events,
    get_raw_file_by_id,
    resolve_parse_task_for_websocket,
)
from app.services.mistral_ocr_service import get_ocr_service


type ProgressReporter = Callable[[str, str, str, int], Awaitable[None]]
type MessageSender = Callable[[dict[str, Any]], Awaitable[None]]
type ParseBranch = list[dict[str, Any]]


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def _resolve_get_ocr_service(ocr_service_factory=None):
    if ocr_service_factory is not None:
        return ocr_service_factory
    return get_ocr_service


def _resolve_classify_images_batch(classifier=None):
    if classifier is not None:
        return classifier
    return module_image_classifier


def _resolve_chapter_splitter(splitter=None):
    if splitter is not None:
        return splitter
    return chapter_splitter


def _resolve_module_parsing_service_factory(service_factory=None):
    if service_factory is not None:
        return service_factory

    from app.services.module_parsing_service import ModuleParsingService

    return ModuleParsingService


def _resolve_get_ai_settings_fn(get_ai_settings_fn=None):
    if get_ai_settings_fn is not None:
        return get_ai_settings_fn

    from app.services.module_parsing_service import get_ai_settings_from_db

    return get_ai_settings_from_db


def _resolve_pipeline_factory(pipeline_factory=None):
    if pipeline_factory is not None:
        return pipeline_factory

    from app.domain.parsing.pipeline import ModuleParsingPipeline

    return ModuleParsingPipeline


def _resolve_register_cancel_token_fn(register_cancel_token_fn=None):
    if register_cancel_token_fn is not None:
        return register_cancel_token_fn

    from app.domain.parsing.pipeline import register_cancel_token

    return register_cancel_token


def _resolve_cleanup_cancel_token_fn(cleanup_cancel_token_fn=None):
    if cleanup_cancel_token_fn is not None:
        return cleanup_cancel_token_fn

    from app.domain.parsing.pipeline import cleanup_cancel_token

    return cleanup_cancel_token


def _resolve_cancelled_error_type(cancelled_error_type=None):
    if cancelled_error_type is not None:
        return cancelled_error_type

    from app.domain.parsing.pipeline import CancelledError

    return CancelledError


def _resolve_update_task_fn(update_task_fn=None):
    if update_task_fn is not None:
        return update_task_fn

    from app.services import module_file_manager

    return module_file_manager.update_task


async def _persist_ocr_snapshot(
    db: AsyncSession,
    raw_file: Any,
    *,
    markdown_content: str,
    source_language: str,
    ocr_provider: str | None = None,
    persist_ocr_snapshot_fn= None,  # type: ignore[assignment]
) -> None:
    if persist_ocr_snapshot_fn is None:
        await persist_ocr_snapshot(
            db,
            raw_file,
            markdown_content=markdown_content,
            source_language=source_language,
            ocr_provider=ocr_provider,
        )
        return

    kwargs = {
        "markdown_content": markdown_content,
        "source_language": source_language,
    }
    signature = inspect.signature(persist_ocr_snapshot_fn)
    supports_ocr_provider = (
        "ocr_provider" in signature.parameters
        or any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )
    )
    if supports_ocr_provider:
        kwargs["ocr_provider"] = ocr_provider

    await persist_ocr_snapshot_fn(
        db,
        raw_file,
        **kwargs,
    )


async def _persist_translated_markdown(
    db: AsyncSession,
    raw_file: Any,
    *,
    markdown_content: str,
    is_translated: str,
    persist_translated_markdown_fn= None,  # type: ignore[assignment]
) -> None:
    if persist_translated_markdown_fn is None:
        await persist_translated_markdown(
            db,
            raw_file,
            markdown_content=markdown_content,
            is_translated=is_translated,
        )
        return
    await persist_translated_markdown_fn(
        db,
        raw_file,
        markdown_content=markdown_content,
        is_translated=is_translated,
    )


async def run_parse_raw_file_ws_session(
    *,
    file_id: str,
    db: AsyncSession,
    progress_sender: ProgressReporter,
    send_json: MessageSender,
    raw_files_dir: Path,
    get_raw_file_by_id_fn=get_raw_file_by_id,
    resolve_parse_task_fn=resolve_parse_task_for_websocket,
    get_ocr_service_fn=None,
    ocr_image_classifier=None,
    chapter_splitter_fn=None,
    detect_markdown_language_fn=detect_markdown_language,
    translate_markdown_fn=translate_markdown_by_language,
    get_ai_settings_fn=None,
    parsing_service_factory=None,
    persist_ocr_snapshot_fn=None,
    persist_translated_markdown_fn=None,
    persist_parsed_module_output_fn=None,
    update_task_fn=None,
) -> str | None:
    """
    Execute legacy websocket parse flow for /ws/parse/{file_id}.
    Returns the task_id to allow callers to mark failure status on exceptions.
    """
    return await _run_parse_raw_file_ws_session(
        file_id=file_id,
        db=db,
        progress_sender=progress_sender,
        send_json=send_json,
        raw_files_dir=raw_files_dir,
        get_raw_file_by_id_fn=get_raw_file_by_id_fn,
        resolve_parse_task_fn=resolve_parse_task_fn,
        get_ocr_service_fn=get_ocr_service_fn,
        ocr_image_classifier=ocr_image_classifier,
        chapter_splitter_fn=chapter_splitter_fn,
        detect_markdown_language_fn=detect_markdown_language_fn,
        translate_markdown_fn=translate_markdown_fn,
        get_ai_settings_fn=get_ai_settings_fn,
        parsing_service_factory=parsing_service_factory,
        persist_ocr_snapshot_fn=persist_ocr_snapshot_fn,
        persist_translated_markdown_fn=persist_translated_markdown_fn,
        persist_parsed_module_output_fn=persist_parsed_module_output_fn,
        update_task_fn=update_task_fn,
    )


async def _run_parse_raw_file_ws_session(
    *,
    file_id: str,
    db: AsyncSession,
    progress_sender: ProgressReporter,
    send_json: MessageSender,
    raw_files_dir: Path,
    get_raw_file_by_id_fn=get_raw_file_by_id,
    resolve_parse_task_fn=resolve_parse_task_for_websocket,
    get_ocr_service_fn=None,
    ocr_image_classifier=None,
    chapter_splitter_fn=None,
    detect_markdown_language_fn=detect_markdown_language,
    translate_markdown_fn=translate_markdown_by_language,
    get_ai_settings_fn=None,
    parsing_service_factory=None,
    persist_ocr_snapshot_fn=None,
    persist_translated_markdown_fn=None,
    persist_parsed_module_output_fn=None,
    update_task_fn=None,
) -> str | None:
    raw_file = await get_raw_file_by_id_fn(file_id, db)
    if not raw_file:
        await send_json({"type": "error", "message": "File not found"})
        return None

    ocr_service_factory = _resolve_get_ocr_service(get_ocr_service_fn)
    classifier = _resolve_classify_images_batch(ocr_image_classifier)
    splitter = _resolve_chapter_splitter(chapter_splitter_fn)
    parse_service_factory = _resolve_module_parsing_service_factory(parsing_service_factory)
    get_ai_settings = _resolve_get_ai_settings_fn(get_ai_settings_fn)
    update_task = _resolve_update_task_fn(update_task_fn)

    task_state = await _maybe_await(
        resolve_parse_task_fn(file_id, raw_file_status=raw_file.status)
    )
    task_id = task_state["task_id"]
    await send_json({"type": "task_created", "task_id": task_id})

    if task_state["resumed"]:
        await send_json({"type": "resume", "task": task_state["task"]})
        for progress_event in build_resume_progress_events(task_state["task"]):
            await send_json(progress_event)

    file_type = raw_file.file_type
    markdown_content = raw_file.markdown_content
    image_classifications: ParseBranch = raw_file.image_classifications or []

    try:
        if file_type == "pdf" and not markdown_content:
            await progress_sender(task_id, "pdf_convert", "📄 PDF文件检测到，开始转换为Markdown...", 5)

            pdf_path = raw_files_dir / f"{file_id}.pdf"
            if not pdf_path.exists():
                await send_json({"type": "error", "message": "PDF文件不存在"})
                return task_id

            convert_dir = raw_files_dir / file_id / "converted"
            convert_dir.mkdir(parents=True, exist_ok=True)

            ocr_service = ocr_service_factory()
            raw_file = raw_file
            try:
                async def pdf_progress_callback(message: str, progress: int) -> None:
                    mapped_progress = 5 + int((progress - 5) * 0.25)
                    await progress_sender(task_id, "pdf_convert", message, mapped_progress)

                result = normalize_ocr_conversion_result(
                    await ocr_service.convert_pdf_to_markdown(
                        pdf_path,
                        convert_dir,
                        progress_callback=pdf_progress_callback,
                    )
                )
                markdown_content = result.get("markdown_content")
                ocr_result = result.get("ocr_result")
                ocr_provider = resolve_ocr_provider(result)

                await progress_sender(task_id, "chapter_split", "📑 提取章节结构...", 32)
                headings = splitter.extract_headings_from_markdown(markdown_content)
                chapters = splitter.split_by_headings(markdown_content, headings, min_level=1, max_level=2)

                ocr_images_data: ParseBranch = []
                if ocr_result and hasattr(ocr_service, "extract_images_with_context"):
                    await progress_sender(task_id, "image_classify", "🖼️ 正在提取图片...", 35)
                    images_with_context = ocr_service.extract_images_with_context(ocr_result, markdown_content)

                    for img_info in images_with_context:
                        chapter_name = splitter.find_chapter_for_image(
                            img_info["image_id"],
                            markdown_content,
                            chapters
                        ) or ""
                        ocr_images_data.append(
                            {
                                "image_id": img_info["image_id"],
                                "image_base64": img_info["image_base64"],
                                "context": img_info["context"],
                                "chapter": chapter_name,
                                "page_index": img_info["page_index"],
                            }
                        )

                    raw_file.ocr_images = ocr_images_data
                    await db.commit()

                    async def classify_progress(msg: str, prog: int) -> None:
                        progress = 35 + int(prog * 0.05)
                        await progress_sender(task_id, "image_classify", msg, progress)

                    try:
                        classifications = await classifier.classify_images_batch(
                            db=db,
                            images=ocr_images_data,
                            progress_callback=classify_progress,
                        )

                        for i, classification in enumerate(classifications):
                            img_info = ocr_images_data[i]
                            image_classifications.append(
                                {
                                    "image_id": img_info["image_id"],
                                    "image_base64": f"data:image/png;base64,{img_info['image_base64']}"
                                    if not img_info["image_base64"].startswith("data:")
                                    else img_info["image_base64"],
                                    "category": classification.category.value,
                                    "description": classification.description,
                                    "confidence": classification.confidence,
                                    "related_entity": classification.related_entity,
                                    "chapter": img_info["chapter"],
                                    "page_index": img_info["page_index"],
                                }
                            )

                        if image_classifications:
                            raw_file.image_classifications = image_classifications
                            await db.commit()

                    except Exception:
                        pass

                async def report_translate_progress(message: str, progress: int) -> None:
                    await progress_sender(task_id, "translate", message, progress)

                language = await detect_markdown_language_fn(
                    markdown_content,
                    report_progress=report_translate_progress,
                )
                await _persist_ocr_snapshot(
                    db,
                    raw_file,
                    markdown_content=markdown_content,
                    source_language=language,
                    ocr_provider=ocr_provider,
                    persist_ocr_snapshot_fn=persist_ocr_snapshot_fn,
                )

                translation_result = await translate_markdown_fn(
                    markdown_content,
                    language,
                    report_progress=report_translate_progress,
                )
                markdown_content = translation_result["markdown_content"]
                await _persist_translated_markdown(
                    db,
                    raw_file,
                    markdown_content=markdown_content,
                    is_translated=translation_result["is_translated"],
                    persist_translated_markdown_fn=persist_translated_markdown_fn,
                )

                if pdf_path.exists():
                    pdf_path.unlink()
                if convert_dir.exists():
                    shutil.rmtree(convert_dir)
            except Exception as e:
                raw_file.status = "error"
                raw_file.error_message = str(e)
                await db.commit()
                raise Exception(f"PDF conversion failed: {str(e)}")

        elif file_type == "pdf" and markdown_content and raw_file.status == "ocr_complete":
            await progress_sender(
                task_id,
                "translate",
                "📝 检测到OCR已完成，继续翻译...",
                42,
            )

            language = raw_file.source_language or "en"

            async def report_resume_progress(message: str, progress: int) -> None:
                await progress_sender(task_id, "translate", message, progress)

            translation_result = await translate_markdown_fn(
                markdown_content,
                language,
                report_progress=report_resume_progress,
            )
            markdown_content = translation_result["markdown_content"]
            await _persist_translated_markdown(
                db,
                raw_file,
                markdown_content=markdown_content,
                is_translated=translation_result["is_translated"],
                persist_translated_markdown_fn=persist_translated_markdown_fn,
            )

        if not markdown_content:
            raise Exception("No markdown content available")

        temp_md_path = raw_files_dir / f"temp_{file_id}.md"
        output_dir = raw_files_dir / str(raw_file.id) / "parsed"
        try:
            await progress_sender(task_id, "parse_chapters", "📖 开始解析模组内容...", 70)

            with open(temp_md_path, "w", encoding="utf-8") as temp_md:
                temp_md.write(markdown_content)

            ai_settings = await _maybe_await(get_ai_settings())
            parsing_service = parse_service_factory(
                ai_settings=ai_settings,
                output_dir=output_dir,
            )

            async def parse_progress_callback(step: str, message: str, progress: int, batch_num: int = None) -> None:
                mapped_progress = 70 + int(progress * 0.3)
                await progress_sender(task_id, step, message, mapped_progress)

            parse_result = await parsing_service.parse_module_file(
                markdown_path=temp_md_path,
                progress_callback=parse_progress_callback,
                skip_monsters=False,
                skip_items=False,
            )

            if persist_parsed_module_output_fn is None:
                persist_result = await persist_parsed_module_output(
                    db,
                    raw_file,
                    file_id=file_id,
                    parse_result=parse_result,
                    image_classifications=image_classifications,
                )
            else:
                persist_result = await persist_parsed_module_output_fn(
                    db,
                    raw_file,
                    file_id=file_id,
                    parse_result=parse_result,
                    image_classifications=image_classifications,
                )

            module_id = persist_result["module_id"]
            result = persist_result["result"]

            if output_dir.exists():
                shutil.rmtree(output_dir)
            await progress_sender(task_id, "complete", "✅ 模组解析完成！", 100)
            await send_json({"type": "complete", "module_id": module_id, "stats": result.get("stats", {})})
        finally:
            if temp_md_path.exists():
                temp_md_path.unlink()

        return task_id
    except Exception as e:
        try:
            update_task(task_id, {"status": "failed", "error_message": str(e)})
        except Exception:
            pass
        try:
            await send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        return task_id


async def run_parse_raw_file_ws_v2_session(
    *,
    file_id: str,
    db: AsyncSession,
    send_json: MessageSender,
    raw_files_dir: Path,
    get_raw_file_by_id_fn=get_raw_file_by_id,
    resolve_parse_task_fn=resolve_parse_task_for_websocket,
    register_cancel_token_fn=None,
    cleanup_cancel_token_fn=None,
    pipeline_factory=None,
    build_resume_progress_events_fn=build_resume_progress_events,
    cancelled_error_type=None,
    update_task_fn=None,
) -> str | None:
    """Execute parse-v2 websocket flow, reusing existing markdown when available."""
    update_task = _resolve_update_task_fn(update_task_fn)
    raw_file = await get_raw_file_by_id_fn(file_id, db)
    if not raw_file:
        await send_json({"type": "error", "message": "文件不存在"})
        return None

    # Re-parse from existing markdown instead of forcing OCR again.
    if raw_file.markdown_content:
        async def legacy_progress_sender(
            _task_id: str,
            step: str,
            message: str,
            progress: int,
        ) -> None:
            await send_json(
                {
                    "type": "progress",
                    "step": step,
                    "message": message,
                    "progress": progress,
                }
            )

        return await run_parse_raw_file_ws_session(
            file_id=file_id,
            db=db,
            progress_sender=legacy_progress_sender,
            send_json=send_json,
            raw_files_dir=raw_files_dir,
            get_raw_file_by_id_fn=get_raw_file_by_id_fn,
            resolve_parse_task_fn=resolve_parse_task_fn,
            update_task_fn=update_task_fn,
        )

    if raw_file.file_type != "pdf":
        await send_json({"type": "error", "message": "当前文件没有可复用的Markdown内容"})
        return None

    pdf_path = raw_files_dir / f"{file_id}.pdf"
    if not pdf_path.exists():
        await send_json({"type": "error", "message": "PDF文件不存在"})
        return None

    task_id = None
    register_cancel_token = _resolve_register_cancel_token_fn(register_cancel_token_fn)
    cleanup_cancel_token = _resolve_cleanup_cancel_token_fn(cleanup_cancel_token_fn)
    pipeline_factory = _resolve_pipeline_factory(pipeline_factory)
    cancelled_error = _resolve_cancelled_error_type(cancelled_error_type)

    try:
        task_state = await _maybe_await(
            resolve_parse_task_fn(
                file_id,
                raw_file_status=raw_file.status,
            )
        )
        task_id = task_state["task_id"]
        cancel_token = register_cancel_token(task_id)
        await send_json({"type": "task_created", "task_id": task_id})

        if task_state["resumed"]:
            await send_json({"type": "resume", "task": task_state["task"]})
            for progress_event in build_resume_progress_events_fn(task_state["task"]):
                await send_json(progress_event)

        async def progress_callback(stage: str, message: str, percent: int):
            await send_json({
                "type": "progress",
                "step": stage,
                "message": message,
                "progress": percent,
            })

        pipeline = pipeline_factory(db)
        parse_result = await pipeline.run(
            raw_file=raw_file,
            pdf_path=pdf_path,
            progress_callback=progress_callback,
            skip_image_classify=False,
            cancel_token=cancel_token,
        )

        toc_count = len(getattr(parse_result, "toc", []))
        images_count = len(getattr(parse_result, "images", []))
        await send_json({
            "type": "complete",
            "message": "解析完成",
            "module_id": raw_file.parsed_module_id,
            "toc_count": toc_count,
            "images_count": images_count,
        })
        return task_id

    except cancelled_error:
        if task_id is not None:
            try:
                update_task(task_id, {"status": "stopped", "current_message": "解析已停止"})
            except Exception:
                pass
        try:
            await send_json({
                "type": "stopped",
                "message": "解析已停止",
            })
        except Exception:
            pass
        return task_id

    except Exception as e:
        if task_id is not None:
            try:
                update_task(task_id, {"status": "failed", "error_message": str(e)})
            except Exception:
                pass
        try:
            await send_json({"type": "error", "message": f"解析失败: {str(e)}"})
        except Exception:
            pass
        return task_id
    finally:
        if task_id:
            try:
                cleanup_cancel_token(task_id)
            except Exception:
                pass
