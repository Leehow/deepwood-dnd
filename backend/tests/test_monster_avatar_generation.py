"""
Unit test for monster avatar generation API
"""
import asyncio
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models.monster_instance import MonsterInstance
from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType
from app.services.ai_model_service import ai_model_service
from app.api.routes.monster_instances import generate_monster_avatar
from app.schemas.monster_instance import MonsterAvatarGenerationRequest
from app.core.config import settings


async def test_monster_avatar_generation():
    """Test monster avatar generation with a real monster instance"""
    
    # Create async engine
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        # Find a monster instance to test with
        from sqlalchemy import select
        result = await db.execute(
            select(MonsterInstance).where(MonsterInstance.monster_id == "fire_snake").limit(1)
        )
        monster = result.scalar_one_or_none()
        
        if not monster:
            print("❌ No fire_snake monster found in database")
            return
        
        print(f"✅ Found monster: {monster.name_cn} (ID: {monster.id})")
        print(f"   Monster ID: {monster.monster_id}")
        print(f"   Size: {monster.size}")
        print(f"   Type: {monster.type}")
        print(f"   CR: {monster.challenge_rating}")
        
        # Check monster_data
        if monster.monster_data:
            print(f"   Monster data keys: {list(monster.monster_data.keys())}")
            if "appearance" in monster.monster_data:
                print(f"   Has appearance: {monster.monster_data['appearance'][:100]}...")
            elif "description" in monster.monster_data:
                print(f"   Has description: {monster.monster_data['description'][:100]}...")
        
        # Get FAST_IMAGE model config
        try:
            image_config = await ai_model_service.get_model_config(db, ModelType.FAST_IMAGE)
            print(f"\n✅ FAST_IMAGE model config:")
            print(f"   Model: {image_config.model_name}")
            print(f"   API URL: {image_config.api_url}")
        except Exception as e:
            print(f"\n❌ Failed to get FAST_IMAGE model config: {e}")
            return
        
        # Get FAST model config (for appearance generation)
        try:
            fast_config = await ai_model_service.get_model_config(db, ModelType.FAST)
            print(f"\n✅ FAST model config:")
            print(f"   Model: {fast_config.model_name}")
            print(f"   API URL: {fast_config.api_url}")
        except Exception as e:
            print(f"\n❌ Failed to get FAST model config: {e}")
            return
        
        # Create request
        request = MonsterAvatarGenerationRequest(
            monster_instance_id=monster.id
        )
        
        print(f"\n🚀 Starting avatar generation for monster instance {monster.id}...")
        print("=" * 80)
        
        # Call the avatar generation endpoint
        try:
            response = await generate_monster_avatar(request, db)
            
            print("=" * 80)
            print(f"\n✅ Avatar generation successful!")
            print(f"   Success: {response.success}")
            print(f"   Avatar URL: {response.avatar_url}")
            print(f"   Prompt: {response.prompt[:200]}...")
            
            # Verify the monster was updated
            await db.refresh(monster)
            print(f"\n✅ Monster instance updated:")
            print(f"   Has avatar: {monster.has_avatar}")
            print(f"   Avatar URL: {monster.avatar_url}")
            
        except Exception as e:
            print("=" * 80)
            print(f"\n❌ Avatar generation failed: {e}")
            import traceback
            traceback.print_exc()
    
    await engine.dispose()


if __name__ == "__main__":
    print("=" * 80)
    print("Monster Avatar Generation Test")
    print("=" * 80)
    asyncio.run(test_monster_avatar_generation())

