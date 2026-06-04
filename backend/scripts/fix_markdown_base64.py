"""
修复已解析模组 markdown 中残留的 base64 图片引用。

用 raw_module_files.ocr_images 中的 oss_url 替换 markdown_content 中的
data:image/... base64 数据。

用法:
  cd backend && source venv/bin/activate
  python scripts/fix_markdown_base64.py          # dry-run 预览
  python scripts/fix_markdown_base64.py --apply   # 实际修改数据库
"""
import asyncio
import re
import sys

from sqlalchemy import select, text
from app.db.session import async_session_maker
from app.models.raw_module_file import RawModuleFile


async def fix_markdown_base64(apply: bool = False):
    async with async_session_maker() as db:
        # 找出 markdown 里含有 base64 的 raw_module_files
        result = await db.execute(
            select(RawModuleFile).where(
                RawModuleFile.markdown_content.ilike("%data:image/%base64%")
            )
        )
        files = result.scalars().all()
        print(f"找到 {len(files)} 个含 base64 的文件")

        for f in files:
            md = f.markdown_content or ""
            original_len = len(md)

            # 从 ocr_images 构建 oss_url 映射
            oss_map = {}
            for img in (f.ocr_images or []):
                img_id = img.get("image_id", "")
                oss_url = img.get("oss_url", "")
                if img_id and oss_url:
                    oss_map[img_id] = oss_url

            replaced = 0
            # 用 oss_url 替换 base64（支持跨行）
            for image_id, oss_url in oss_map.items():
                esc_id = re.escape(image_id)
                base_id = re.escape(image_id.rsplit('.', 1)[0]) if '.' in image_id else esc_id

                # ![image_id](data:image/...) 或 ![含image_id](data:...)
                pattern = re.compile(
                    rf'!\[([^\]]*(?:{esc_id}|{base_id})[^\]]*)\]\s*\(data:image/[^)]+\)',
                    re.IGNORECASE | re.DOTALL
                )
                new_md, n = pattern.subn(f'![{image_id}]({oss_url})', md)
                if n > 0:
                    md = new_md
                    replaced += n

            # 兜底：清除剩余 base64
            md, n_cleanup = re.subn(
                r'!\[([^\]]*)\]\s*\(data:image/[^)]+\)',
                r'![\1]()',
                md,
                flags=re.DOTALL
            )
            replaced += n_cleanup

            new_len = len(md)
            saved_kb = (original_len - new_len) / 1024
            print(
                f"  [{f.id}] {f.title[:40]:40s} | "
                f"替换 {replaced} 处 | "
                f"{original_len:,} -> {new_len:,} 字符 | "
                f"节省 {saved_kb:.0f} KB"
            )

            if apply and replaced > 0:
                f.markdown_content = md

        if apply:
            await db.commit()
            print(f"\n已提交修改。")
        else:
            print(f"\n[dry-run] 未修改数据库。加 --apply 参数实际执行。")


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(fix_markdown_base64(apply))
