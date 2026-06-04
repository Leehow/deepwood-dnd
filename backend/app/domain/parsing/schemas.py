"""
解析系统数据模型
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from enum import Enum


class ImageCategory(str, Enum):
    """图片分类"""
    MAP = "map"
    CHARACTER_PORTRAIT = "character_portrait"
    MONSTER_PORTRAIT = "monster_portrait"
    SCENE = "scene"
    ITEM = "item"
    UNKNOWN = "unknown"


@dataclass
class OCRImage:
    """OCR提取的图片"""
    image_id: str
    image_base64: str
    page_index: int
    context: str = ""  # 图片周围的文字


@dataclass
class ProcessedImage:
    """处理后的图片"""
    image_id: str
    oss_url: str
    thumbnail_url: str
    category: str = "unknown"
    description: str = ""
    page_index: int = 0
    chapter_title: str = ""  # 所属章节标题
    line_number: int = 0  # 图片在markdown中的行号

    def to_dict(self) -> Dict:
        return {
            "image_id": self.image_id,
            "oss_url": self.oss_url,
            "thumbnail_url": self.thumbnail_url,
            "category": self.category,
            "description": self.description,
            "page_index": self.page_index,
            "chapter_title": self.chapter_title,
            "line_number": self.line_number
        }


@dataclass
class OCRTable:
    """OCR提取的表格"""
    table_id: str
    content: str  # markdown或html格式的表格内容
    page_index: int = 0
    chapter_title: str = ""  # 所属章节标题
    line_number: int = 0  # 表格在markdown中的行号

    def to_dict(self) -> Dict:
        return {
            "table_id": self.table_id,
            "content": self.content,
            "page_index": self.page_index,
            "chapter_title": self.chapter_title,
            "line_number": self.line_number
        }


@dataclass
class TocEntry:
    """目录项"""
    title: str
    level: int  # 1, 2, 3
    line_number: int
    title_en: Optional[str] = None
    content: Optional[str] = None  # 章节内容（markdown格式）
    children: List["TocEntry"] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "title": self.title,
            "title_en": self.title_en,
            "level": self.level,
            "line_number": self.line_number,
            "content": self.content,
            "children": [c.to_dict() for c in self.children]
        }


@dataclass
class ParseResult:
    """解析结果"""
    markdown: str = ""
    toc: List[TocEntry] = field(default_factory=list)
    images: List[ProcessedImage] = field(default_factory=list)
    tables: List[OCRTable] = field(default_factory=list)
    monsters: List[Dict] = field(default_factory=list)
    items: List[Dict] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "markdown": self.markdown,
            "toc": [t.to_dict() for t in self.toc],
            "images": [i.to_dict() for i in self.images],
            "tables": [t.to_dict() for t in self.tables],
            "errors": self.errors
        }

    @property
    def success(self) -> bool:
        return len(self.errors) == 0
