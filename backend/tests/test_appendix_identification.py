"""
Test appendix identification with AI classification
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

import pytest

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

ParseOrchestrator = pytest.importorskip(
    "app.domain.parsing.orchestrator",
    reason="Legacy parsing orchestrator module is not present in the current backend",
).ParseOrchestrator


async def load_ai_settings_from_db():
    """Load AI settings from database"""
    # Get database URL from environment
    db_url = os.getenv('DATABASE_URL', 'postgresql+asyncpg://postgres:postgres@localhost:5432/dnd_platform')

    # Create async engine
    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Get global AI settings
        result = await session.execute(
            text("SELECT id FROM ai_api_settings WHERE user_id = 'global'")
        )
        settings_row = result.fetchone()

        if not settings_row:
            raise RuntimeError("No global AI settings found in database")

        settings_id = settings_row[0]

        # Get model configs
        result = await session.execute(
            text("SELECT model_type, api_url, api_key, model_name FROM ai_model_configs WHERE settings_id = :settings_id"),
            {"settings_id": settings_id}
        )
        config_rows = result.fetchall()

        # Build ai_settings dict
        ai_settings = {'models': {}}
        for row in config_rows:
            model_type = row[0]
            ai_settings['models'][model_type] = {
                'api_url': row[1],
                'api_key': row[2],
                'model_name': row[3]
            }

        await engine.dispose()
        return ai_settings


async def test_appendix_identification():
    """Test AI-based appendix identification on real module file"""

    # Path to the converted markdown file
    md_file = Path("/Users/haoli/leehow/code/dw/dnd-platform/upload/dae5122d-8c63-402e-9f6a-45e4d29ecb7e/converted/converted.md")

    if not md_file.exists():
        print(f"❌ File not found: {md_file}")
        return

    print(f"📖 Reading file: {md_file.name}")
    print(f"📏 File size: {md_file.stat().st_size / 1024:.1f} KB\n")

    # Read markdown content
    with open(md_file, 'r', encoding='utf-8') as f:
        md_lines = f.readlines()

    print(f"📄 Total lines: {len(md_lines)}\n")

    # Load AI settings from database
    print("🔧 Loading AI settings from database...")
    ai_settings = await load_ai_settings_from_db()
    print(f"✅ Loaded {len(ai_settings['models'])} model configs\n")

    # Setup logger
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
    logger.addHandler(handler)

    orchestrator = ParseOrchestrator(
        ai_settings=ai_settings,
        output_dir=md_file.parent,
        logger=logger
    )
    
    print("🔍 Identifying appendices with AI classification...\n")
    
    # Call the appendix identification method
    appendices = await orchestrator._identify_appendices(md_lines)
    
    print(f"\n✅ Found {len(appendices)} appendices:\n")
    
    for appendix_type, info in appendices.items():
        print(f"📌 Type: {appendix_type}")
        print(f"   Title: {info['title']}")
        print(f"   Lines: {info['start']} - {info['end']}")
        print(f"   Length: {info['end'] - info['start']} lines")
        
        # Show first 200 characters of content
        content_preview = ''.join(md_lines[info['start']:min(info['start'] + 10, info['end'])])
        print(f"   Preview: {content_preview[:200]}...")
        print()
    
    # Verify expected appendices
    print("\n🧪 Verification:")
    
    expected_types = ['items', 'monsters']
    found_types = []
    
    for appendix_type in appendices.keys():
        # Remove numeric suffixes (_2, _3, etc.)
        base_type = appendix_type.split('_')[0]
        if base_type in expected_types:
            found_types.append(base_type)
    
    print(f"   Expected: {expected_types}")
    print(f"   Found: {found_types}")
    
    if set(found_types) == set(expected_types):
        print("   ✅ All expected appendices found!")
    else:
        missing = set(expected_types) - set(found_types)
        extra = set(found_types) - set(expected_types)
        if missing:
            print(f"   ⚠️  Missing: {missing}")
        if extra:
            print(f"   ⚠️  Extra: {extra}")
    
    return appendices


if __name__ == "__main__":
    print("=" * 80)
    print("🧪 Testing Appendix Identification with AI Classification")
    print("=" * 80)
    print()
    
    result = asyncio.run(test_appendix_identification())
    
    print("\n" + "=" * 80)
    print("✅ Test completed!")
    print("=" * 80)

