#!/usr/bin/env python3
import sys
sys.path.insert(0, '/Users/haoli/leehow/code/dw/backend')

import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_URL = "postgresql+asyncpg://haoli@localhost:5432/dnd_platform"

async def check_structure():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        # 检查表结构
        print("=== campaign_members表结构 ===")
        result = await conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'campaign_members'
            ORDER BY ordinal_position
        """))
        for row in result:
            print(f"  {row[0]}: {row[1]} (nullable={row[2]})")
        
        print("\n=== drawings表结构 ===")
        result = await conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'drawings'
            ORDER BY ordinal_position
        """))
        for row in result:
            print(f"  {row[0]}: {row[1]} (nullable={row[2]})")
    
    await engine.dispose()

asyncio.run(check_structure())
