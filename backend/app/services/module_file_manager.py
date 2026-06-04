"""
Module File Manager Service
Handles JSON file operations for raw files, parsed modules, and parse tasks
"""
import json
import threading
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
import uuid


class ModuleFileManager:
    """Manages JSON metadata files for module system"""

    def __init__(self):
        # Storage directories
        from app.utils.rules_cache import PROJECT_ROOT
        base_dir = PROJECT_ROOT / "dnd-platform"
        self.raw_files_dir = base_dir / "upload"
        self.parsed_modules_dir = base_dir / "configs" / "modules"

        # Ensure directories exist
        self.raw_files_dir.mkdir(parents=True, exist_ok=True)
        self.parsed_modules_dir.mkdir(parents=True, exist_ok=True)

        # Metadata files
        self.raw_metadata_file = self.raw_files_dir / "raw_files_metadata.json"
        self.parsed_metadata_file = self.parsed_modules_dir / "parsed_modules_metadata.json"
        self.parse_tasks_file = self.raw_files_dir / "parse_tasks.json"

        # Lock for thread-safe file operations
        self._lock = threading.Lock()

    # ===== Raw Metadata Operations =====

    def load_raw_metadata(self) -> List[dict]:
        """Load raw files metadata"""
        if self.raw_metadata_file.exists():
            try:
                with open(self.raw_metadata_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading raw metadata: {e}")
                return []
        return []

    def save_raw_metadata(self, metadata: List[dict]) -> None:
        """Save raw files metadata"""
        try:
            with open(self.raw_metadata_file, "w", encoding="utf-8") as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving raw metadata: {e}")
            raise

    # ===== Parsed Metadata Operations =====

    def load_parsed_metadata(self) -> List[dict]:
        """Load parsed modules metadata"""
        if self.parsed_metadata_file.exists():
            try:
                with open(self.parsed_metadata_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading parsed metadata: {e}")
                return []
        return []

    def save_parsed_metadata(self, metadata: List[dict]) -> None:
        """Save parsed modules metadata"""
        try:
            with open(self.parsed_metadata_file, "w", encoding="utf-8") as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving parsed metadata: {e}")

    # ===== Parse Tasks Operations =====

    def load_parse_tasks(self) -> List[dict]:
        """Load parse tasks"""
        if self.parse_tasks_file.exists():
            try:
                with open(self.parse_tasks_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading parse tasks: {e}")
                return []
        return []

    def save_parse_tasks(self, tasks: List[dict]) -> None:
        """Save parse tasks"""
        try:
            with open(self.parse_tasks_file, "w", encoding="utf-8") as f:
                json.dump(tasks, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving parse tasks: {e}")

    def get_task_by_id(self, task_id: str) -> Optional[dict]:
        """Get task by ID"""
        tasks = self.load_parse_tasks()
        for task in tasks:
            if task["id"] == task_id:
                return task
        return None

    def get_task_by_file_id(self, file_id: str) -> Optional[dict]:
        """Get active task by file ID"""
        tasks = self.load_parse_tasks()
        for task in tasks:
            if task["file_id"] == file_id and task["status"] in ["pending", "running"]:
                return task
        return None

    def update_task(self, task_id: str, updates: dict) -> Optional[dict]:
        """Update task with new data (thread-safe atomic operation)"""
        with self._lock:
            # Truncate error_message if too long (prevent 273MB error messages!)
            if 'error_message' in updates and updates['error_message']:
                if len(updates['error_message']) > 1000:
                    updates['error_message'] = updates['error_message'][:1000] + '... [truncated]'

            tasks = self.load_parse_tasks()
            for i, task in enumerate(tasks):
                if task["id"] == task_id:
                    task.update(updates)
                    task["updated_at"] = datetime.now().isoformat()
                    tasks[i] = task
                    self.save_parse_tasks(tasks)
                    return task
            return None

    def create_task(self, file_id: str) -> dict:
        """Create new parse task (thread-safe)"""
        with self._lock:
            task_id = str(uuid.uuid4())
            task = {
                "id": task_id,
                "file_id": file_id,
                "status": "pending",
                "progress": 0,
                "current_step": "",
                "current_message": "",
                "steps_completed": [],
                "batch_messages": [],
                "module_id": None,
                "error_message": None,
                "created_at": datetime.now().isoformat(),
                "started_at": None,
                "completed_at": None,
                "updated_at": datetime.now().isoformat()
            }

            tasks = self.load_parse_tasks()
            tasks.append(task)
            self.save_parse_tasks(tasks)

            return task

    def update_task_progress(
        self,
        task_id: str,
        step: str,
        message: str,
        progress: int,
        include_batch: bool = True
    ) -> Optional[dict]:
        """Update task progress"""
        updates = {
            "current_step": step,
            "current_message": message,
            "progress": progress,
            "status": "running" if progress < 100 else "completed"
        }

        # Add to batch messages if it's a batch message
        if include_batch and any(emoji in message for emoji in ["📚", "⏳", "✅", "🔍", "💎"]):
            task = self.get_task_by_id(task_id)
            if task:
                batch_messages = task.get("batch_messages", [])
                batch_messages.append(message)
                # Keep only last 20 messages
                updates["batch_messages"] = batch_messages[-20:]

        return self.update_task(task_id, updates)


# Singleton instance
module_file_manager = ModuleFileManager()
