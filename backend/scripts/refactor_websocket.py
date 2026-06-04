#!/usr/bin/env python3
"""
Refactor WebSocket handlers from monolithic file into separate modules.
Part of the project optimization initiative.
"""

import ast
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import argparse

WEBSOCKET_FILE = Path("app/api/routes/websocket.py")
HANDLERS_DIR = Path("app/api/websocket/handlers")
REGISTRY_FILE = HANDLERS_DIR / "__init__.py"

class WebSocketRefactorer:
    """Extract WebSocket message handlers into separate modules."""

    def __init__(self, source_file: Path, target_dir: Path):
        self.source_file = source_file
        self.target_dir = target_dir
        self.handlers: Dict[str, str] = {}
        self.imports: List[str] = []

    def analyze_source(self) -> Dict[str, List[str]]:
        """Analyze source file to identify message handlers."""
        if not self.source_file.exists():
            raise FileNotFoundError(f"Source file not found: {self.source_file}")

        with open(self.source_file, 'r') as f:
            content = f.read()

        # Pattern to find message type handlers
        # Looking for patterns like: if message_type == "something" or case "something"
        handlers_found = {}

        # Find if/elif blocks
        if_pattern = r'if\s+(?:data\.get\(["\']type["\']\)|message_type|msg_type)\s*==\s*["\'](\w+)["\']'
        elif_pattern = r'elif\s+(?:data\.get\(["\']type["\']\)|message_type|msg_type)\s*==\s*["\'](\w+)["\']'

        for pattern in [if_pattern, elif_pattern]:
            matches = re.finditer(pattern, content, re.MULTILINE)
            for match in matches:
                handler_type = match.group(1)
                # Extract the code block for this handler
                start_pos = match.end()
                # Find the next elif/else/except or end of function
                end_pattern = r'\n(?:elif|else|except|finally|\S)'
                end_match = re.search(end_pattern, content[start_pos:])
                if end_match:
                    handler_code = content[start_pos:start_pos + end_match.start()]
                else:
                    handler_code = content[start_pos:]
                handlers_found[handler_type] = handler_code

        return handlers_found

    def create_handler_module(self, handler_name: str, handler_code: str) -> str:
        """Create a handler module for a specific message type."""
        class_name = self._to_class_name(handler_name)

        template = f'''"""
Handler for {handler_name} WebSocket messages.
Auto-generated from monolithic websocket.py
"""

from typing import Dict, Any, Optional
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.websocket.base import BaseHandler


class {class_name}(BaseHandler):
    """Handle {handler_name} messages."""

    async def handle(
        self,
        ws: WebSocket,
        data: Dict[str, Any],
        db: AsyncSession
    ) -> Optional[Dict[str, Any]]:
        """
        Process {handler_name} message.

        Args:
            ws: WebSocket connection
            data: Message data
            db: Database session

        Returns:
            Response data if any
        """
        # TODO: Migrate handler logic here
        {self._indent_code(handler_code)}

        return None  # Modify as needed
'''
        return template

    def create_base_handler(self) -> str:
        """Create base handler class."""
        return '''"""
Base handler class for WebSocket messages.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession


class BaseHandler(ABC):
    """Abstract base class for WebSocket message handlers."""

    @abstractmethod
    async def handle(
        self,
        ws: WebSocket,
        data: Dict[str, Any],
        db: AsyncSession
    ) -> Optional[Dict[str, Any]]:
        """
        Handle a WebSocket message.

        Args:
            ws: WebSocket connection
            data: Message data
            db: Database session

        Returns:
            Response data if any
        """
        pass

    async def broadcast(
        self,
        manager,
        campaign_id: str,
        message: Dict[str, Any],
        exclude_sender: Optional[WebSocket] = None
    ):
        """
        Broadcast message to all connections in campaign.

        Args:
            manager: WebSocket manager instance
            campaign_id: Campaign ID
            message: Message to broadcast
            exclude_sender: WebSocket to exclude from broadcast
        """
        await manager.broadcast_to_campaign(
            campaign_id=campaign_id,
            message=message,
            exclude_sender=exclude_sender
        )
'''

    def create_registry(self, handlers: List[str]) -> str:
        """Create handler registry."""
        imports = []
        registry_entries = []

        for handler in handlers:
            class_name = self._to_class_name(handler)
            module_name = self._to_module_name(handler)
            imports.append(f"from .{module_name} import {class_name}")
            registry_entries.append(f'    "{handler}": {class_name}(),')

        return f'''"""
WebSocket handler registry.
Auto-generated during refactoring.
"""

from typing import Dict, Type
from .base import BaseHandler

# Import all handlers
{chr(10).join(imports)}

# Handler registry mapping message types to handler instances
HANDLER_REGISTRY: Dict[str, BaseHandler] = {{
{chr(10).join(registry_entries)}
}}


def get_handler(message_type: str) -> Optional[BaseHandler]:
    """
    Get handler for a message type.

    Args:
        message_type: Type of message

    Returns:
        Handler instance or None if not found
    """
    return HANDLER_REGISTRY.get(message_type)


__all__ = [
    "BaseHandler",
    "HANDLER_REGISTRY",
    "get_handler",
    {', '.join([f'"{self._to_class_name(h)}"' for h in handlers])}
]
'''

    def _to_class_name(self, handler_name: str) -> str:
        """Convert handler name to class name."""
        parts = handler_name.split('_')
        return ''.join(part.capitalize() for part in parts) + 'Handler'

    def _to_module_name(self, handler_name: str) -> str:
        """Convert handler name to module name."""
        return handler_name.lower().replace('-', '_')

    def _indent_code(self, code: str, spaces: int = 8) -> str:
        """Indent code block."""
        lines = code.split('\n')
        return '\n'.join(' ' * spaces + line if line.strip() else ''
                        for line in lines)

    def refactor(self, dry_run: bool = False) -> Dict[str, str]:
        """
        Perform the refactoring.

        Args:
            dry_run: If True, don't write files

        Returns:
            Dict of created files and their content
        """
        # Analyze source file
        handlers = self.analyze_source()

        if not handlers:
            print("No handlers found to extract")
            return {}

        print(f"Found {len(handlers)} handlers to extract")

        created_files = {}

        # Create target directory
        if not dry_run:
            self.target_dir.mkdir(parents=True, exist_ok=True)

        # Create base handler
        base_file = self.target_dir / "base.py"
        base_content = self.create_base_handler()
        created_files[str(base_file)] = base_content
        if not dry_run:
            base_file.write_text(base_content)

        # Create individual handler modules
        for handler_name in handlers.keys():
            module_name = self._to_module_name(handler_name)
            handler_file = self.target_dir / f"{module_name}.py"
            handler_content = self.create_handler_module(
                handler_name,
                handlers[handler_name]
            )
            created_files[str(handler_file)] = handler_content
            if not dry_run:
                handler_file.write_text(handler_content)
            print(f"  Created handler: {handler_file}")

        # Create registry
        registry_content = self.create_registry(list(handlers.keys()))
        created_files[str(REGISTRY_FILE)] = registry_content
        if not dry_run:
            REGISTRY_FILE.write_text(registry_content)

        return created_files

def main():
    parser = argparse.ArgumentParser(
        description="Refactor WebSocket handlers into separate modules"
    )
    parser.add_argument(
        "--source",
        type=str,
        default=str(WEBSOCKET_FILE),
        help="Source WebSocket file"
    )
    parser.add_argument(
        "--target",
        type=str,
        default=str(HANDLERS_DIR),
        help="Target directory for handlers"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be created without writing files"
    )

    args = parser.parse_args()

    source_file = Path(args.source)
    target_dir = Path(args.target)

    refactorer = WebSocketRefactorer(source_file, target_dir)

    try:
        created_files = refactorer.refactor(dry_run=args.dry_run)

        print(f"\n{'='*60}")
        print(f"WebSocket Refactoring {'Preview' if args.dry_run else 'Complete'}")
        print(f"{'='*60}")
        print(f"Source: {source_file}")
        print(f"Target: {target_dir}")
        print(f"Files {'would be' if args.dry_run else ''} created: {len(created_files)}")

        if args.dry_run:
            print("\nTo apply changes, run without --dry-run")
        else:
            print("\nNext steps:")
            print("1. Review generated handlers in", target_dir)
            print("2. Migrate handler logic from source file")
            print("3. Update main WebSocket endpoint to use registry")
            print("4. Run tests to verify functionality")

    except Exception as e:
        print(f"Error: {e}")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())