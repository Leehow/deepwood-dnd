"""
清理已上传到OSS的本地图片文件
"""
import asyncio
import shutil
from pathlib import Path

RAW_FILES_DIR = Path(__file__).parent.parent.parent / "dnd-platform" / "upload"


async def cleanup_local_images(dry_run: bool = True):
    """
    清理本地图片目录（扫描文件系统）

    Args:
        dry_run: True=只打印不删除, False=实际删除
    """
    if not RAW_FILES_DIR.exists():
        print(f"目录不存在: {RAW_FILES_DIR}")
        return

    cleaned_count = 0
    total_size = 0

    # 扫描所有子目录
    for subdir in RAW_FILES_DIR.iterdir():
        if not subdir.is_dir():
            continue

        images_dir = subdir / "converted" / "images"
        if not images_dir.exists():
            continue

        # 计算目录大小
        dir_size = sum(f.stat().st_size for f in images_dir.rglob("*") if f.is_file())
        file_count = len(list(images_dir.rglob("*")))
        total_size += dir_size

        if dry_run:
            print(f"[待删除] {subdir.name}/converted/images/ ({file_count}个文件, {dir_size/1024/1024:.2f}MB)")
        else:
            shutil.rmtree(images_dir)
            print(f"[已删除] {subdir.name}/converted/images/ ({file_count}个文件, {dir_size/1024/1024:.2f}MB)")

        cleaned_count += 1

    print(f"\n{'=' * 50}")
    print(f"模式: {'预览' if dry_run else '实际删除'}")
    print(f"可清理: {cleaned_count} 个目录")
    print(f"总大小: {total_size/1024/1024:.2f}MB")

    if dry_run and cleaned_count > 0:
        print(f"\n运行 'python scripts/cleanup_local_images.py --execute' 执行删除")


if __name__ == "__main__":
    import sys
    dry_run = "--execute" not in sys.argv
    asyncio.run(cleanup_local_images(dry_run))
