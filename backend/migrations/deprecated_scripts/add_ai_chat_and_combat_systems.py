"""
Database migration to add AI chat and agent combat system tables.

Usage:
    cd backend
    python migrations/add_ai_chat_and_combat_systems.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.session import async_session_maker


async def run_migration():
    """Run the migration to add AI and combat system tables."""

    migration_steps = [
        # Step 1: Create campaign_chat_channels table
        """
        CREATE TABLE IF NOT EXISTS campaign_chat_channels (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Channel info
            channel_name VARCHAR(100) NOT NULL,
            channel_type VARCHAR(50) NOT NULL,
            description TEXT,

            -- AI configuration
            ai_enabled BOOLEAN DEFAULT false,
            ai_role VARCHAR(100),
            ai_personality JSONB DEFAULT '{}',
            ai_context_window INTEGER DEFAULT 50,

            -- Settings
            settings JSONB DEFAULT '{}',
            permissions JSONB DEFAULT '{}',

            -- State
            is_active BOOLEAN DEFAULT true,
            is_archived BOOLEAN DEFAULT false,

            created_at TIMESTAMPTZ DEFAULT NOW(),
            created_by VARCHAR(50) NOT NULL
        );
        """,

        # Step 2: Create indexes for campaign_chat_channels
        """
        CREATE INDEX IF NOT EXISTS idx_campaign_channels
        ON campaign_chat_channels(campaign_id, is_active);
        """,

        # Step 3: Create campaign_chat_messages table
        """
        CREATE TABLE IF NOT EXISTS campaign_chat_messages (
            id BIGSERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
            channel_id INTEGER REFERENCES campaign_chat_channels(id) ON DELETE CASCADE,

            -- Message info
            message_type VARCHAR(50) NOT NULL,
            content TEXT NOT NULL,
            formatted_content JSONB,

            -- Sender info
            sender_id VARCHAR(50),
            sender_type VARCHAR(20) NOT NULL,
            sender_name VARCHAR(100),
            character_id INTEGER,

            -- AI specific
            is_ai_generated BOOLEAN DEFAULT false,
            ai_model_used VARCHAR(50),
            ai_prompt_tokens INTEGER,
            ai_completion_tokens INTEGER,
            ai_context JSONB,
            ai_confidence FLOAT,

            -- Metadata
            metadata JSONB DEFAULT '{}',
            attachments JSONB DEFAULT '[]',

            -- Reply/Thread
            reply_to_id BIGINT REFERENCES campaign_chat_messages(id),
            thread_id BIGINT,

            -- Status
            is_deleted BOOLEAN DEFAULT false,
            is_edited BOOLEAN DEFAULT false,
            edited_at TIMESTAMPTZ,

            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 4: Create indexes for campaign_chat_messages
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_channel_messages
            ON campaign_chat_messages(channel_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_campaign_messages
            ON campaign_chat_messages(campaign_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_thread_messages
            ON campaign_chat_messages(thread_id, created_at)
            WHERE thread_id IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_ai_messages
            ON campaign_chat_messages(campaign_id, is_ai_generated)
            WHERE is_ai_generated = true;
        END $$;
        """,

        # Step 5: Create campaign_ai_memory table
        """
        CREATE TABLE IF NOT EXISTS campaign_ai_memory (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Memory scope
            scope_type VARCHAR(50) NOT NULL,
            scope_id VARCHAR(100) NOT NULL,

            -- Memory data
            memory_type VARCHAR(50) NOT NULL,
            memory_key VARCHAR(200) NOT NULL,
            memory_value JSONB NOT NULL,

            -- Importance and relevance
            importance FLOAT DEFAULT 0.5,
            access_count INTEGER DEFAULT 0,
            last_accessed TIMESTAMPTZ,

            -- Expiration
            expires_at TIMESTAMPTZ,
            is_permanent BOOLEAN DEFAULT false,

            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),

            UNIQUE (campaign_id, scope_type, scope_id, memory_key)
        );
        """,

        # Step 6: Create indexes for campaign_ai_memory
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_memory_access
            ON campaign_ai_memory(campaign_id, scope_type, scope_id, last_accessed DESC);

            CREATE INDEX IF NOT EXISTS idx_memory_importance
            ON campaign_ai_memory(campaign_id, importance DESC);
        END $$;
        """,

        # Step 7: Create campaign_combat_agents table
        """
        CREATE TABLE IF NOT EXISTS campaign_combat_agents (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Agent identification
            agent_name VARCHAR(100) NOT NULL,
            agent_type VARCHAR(50) NOT NULL,
            entity_id VARCHAR(100),

            -- AI configuration
            ai_strategy VARCHAR(50) DEFAULT 'balanced',
            ai_difficulty VARCHAR(20) DEFAULT 'normal',
            ai_behavior_tree JSONB NOT NULL,
            ai_parameters JSONB DEFAULT '{}',

            -- Learning and adaptation
            learning_enabled BOOLEAN DEFAULT false,
            learning_rate FLOAT DEFAULT 0.1,
            experience_data JSONB DEFAULT '{}',
            adaptation_history JSONB DEFAULT '[]',

            -- Combat stats cache
            combat_stats JSONB NOT NULL,
            current_conditions JSONB DEFAULT '[]',

            -- Personality and roleplay
            personality_traits JSONB DEFAULT '{}',
            combat_dialogue JSONB DEFAULT '{}',

            -- State
            is_active BOOLEAN DEFAULT true,
            last_combat_id INTEGER,

            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 8: Create indexes for campaign_combat_agents
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_campaign_agents
            ON campaign_combat_agents(campaign_id, is_active);

            CREATE INDEX IF NOT EXISTS idx_agent_type
            ON campaign_combat_agents(campaign_id, agent_type);
        END $$;
        """,

        # Step 9: Create campaign_combats table
        """
        CREATE TABLE IF NOT EXISTS campaign_combats (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Combat info
            combat_name VARCHAR(200),
            combat_type VARCHAR(50),
            location VARCHAR(200),

            -- Participants
            participants JSONB NOT NULL,
            initiative_order JSONB DEFAULT '[]',

            -- State
            current_round INTEGER DEFAULT 1,
            current_turn INTEGER DEFAULT 0,
            combat_state VARCHAR(20) DEFAULT 'preparing',

            -- AI control
            ai_controlled_count INTEGER DEFAULT 0,
            ai_difficulty VARCHAR(20) DEFAULT 'normal',
            ai_tactics JSONB DEFAULT '{}',

            -- Environment
            battlefield_data JSONB DEFAULT '{}',
            environmental_effects JSONB DEFAULT '[]',

            -- Results
            outcome VARCHAR(50),
            experience_awarded INTEGER,
            loot_generated JSONB,

            -- Timing
            started_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            duration_seconds INTEGER,

            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 10: Create indexes for campaign_combats
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_campaign_combats
            ON campaign_combats(campaign_id, combat_state);

            CREATE INDEX IF NOT EXISTS idx_combat_time
            ON campaign_combats(campaign_id, started_at DESC);
        END $$;
        """,

        # Step 11: Create campaign_combat_logs table
        """
        CREATE TABLE IF NOT EXISTS campaign_combat_logs (
            id BIGSERIAL PRIMARY KEY,
            combat_id INTEGER REFERENCES campaign_combats(id) ON DELETE CASCADE,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Log entry
            round_number INTEGER NOT NULL,
            turn_number INTEGER NOT NULL,
            sequence_number INTEGER NOT NULL,

            -- Action info
            actor_id VARCHAR(100) NOT NULL,
            actor_type VARCHAR(50) NOT NULL,
            action_type VARCHAR(50) NOT NULL,
            action_details JSONB NOT NULL,

            -- Target info
            targets JSONB DEFAULT '[]',

            -- Results
            results JSONB NOT NULL,
            dice_rolls JSONB DEFAULT '[]',

            -- AI decision (if applicable)
            is_ai_action BOOLEAN DEFAULT false,
            ai_decision_data JSONB,
            ai_reasoning TEXT,

            -- Visualization
            animation_data JSONB,
            position_changes JSONB,

            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 12: Create indexes for campaign_combat_logs
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_combat_logs
            ON campaign_combat_logs(combat_id, round_number, turn_number, sequence_number);

            CREATE INDEX IF NOT EXISTS idx_ai_actions
            ON campaign_combat_logs(combat_id, is_ai_action)
            WHERE is_ai_action = true;
        END $$;
        """,

        # Step 13: Create campaign_agent_strategies table
        """
        CREATE TABLE IF NOT EXISTS campaign_agent_strategies (
            id SERIAL PRIMARY KEY,

            -- Strategy info
            strategy_name VARCHAR(100) UNIQUE NOT NULL,
            strategy_type VARCHAR(50) NOT NULL,
            difficulty_level VARCHAR(20),

            -- Behavior definition
            behavior_tree JSONB NOT NULL,
            decision_weights JSONB DEFAULT '{}',

            -- Conditions and triggers
            activation_conditions JSONB DEFAULT '[]',
            priority_rules JSONB DEFAULT '[]',

            -- Tactical preferences
            preferred_actions JSONB DEFAULT '[]',
            avoided_actions JSONB DEFAULT '[]',
            combo_sequences JSONB DEFAULT '[]',

            -- Adaptation rules
            adaptation_triggers JSONB DEFAULT '[]',
            learning_parameters JSONB DEFAULT '{}',

            -- Metadata
            description TEXT,
            tags TEXT[],
            is_public BOOLEAN DEFAULT false,
            created_by VARCHAR(50),

            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 14: Create indexes for campaign_agent_strategies
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_strategy_type
            ON campaign_agent_strategies(strategy_type);

            CREATE INDEX IF NOT EXISTS idx_strategy_tags
            ON campaign_agent_strategies USING GIN(tags);
        END $$;
        """,

        # Step 15: Create campaign_ai_conversations table
        """
        CREATE TABLE IF NOT EXISTS campaign_ai_conversations (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Conversation info
            conversation_type VARCHAR(50) NOT NULL,
            session_id VARCHAR(100) UNIQUE NOT NULL,

            -- Context management
            context_messages JSONB DEFAULT '[]',
            context_tokens INTEGER DEFAULT 0,
            max_context_tokens INTEGER DEFAULT 4000,

            -- System prompts
            system_prompt TEXT,
            role_prompt TEXT,
            custom_instructions JSONB DEFAULT '{}',

            -- AI configuration
            ai_model VARCHAR(50) NOT NULL,
            temperature FLOAT DEFAULT 0.7,
            max_tokens INTEGER DEFAULT 500,

            -- Usage tracking
            total_prompt_tokens INTEGER DEFAULT 0,
            total_completion_tokens INTEGER DEFAULT 0,
            total_cost DECIMAL(10, 6) DEFAULT 0,

            -- State
            is_active BOOLEAN DEFAULT true,
            last_activity TIMESTAMPTZ DEFAULT NOW(),

            created_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ
        );
        """,

        # Step 16: Create indexes for campaign_ai_conversations
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_conversation_session
            ON campaign_ai_conversations(session_id);

            CREATE INDEX IF NOT EXISTS idx_conversation_activity
            ON campaign_ai_conversations(campaign_id, last_activity DESC);
        END $$;
        """,

        # Step 17: Create campaign_ai_prompts table
        """
        CREATE TABLE IF NOT EXISTS campaign_ai_prompts (
            id SERIAL PRIMARY KEY,

            -- Template info
            prompt_name VARCHAR(100) UNIQUE NOT NULL,
            prompt_type VARCHAR(50) NOT NULL,
            category VARCHAR(50),

            -- Template content
            template_content TEXT NOT NULL,
            variables JSONB DEFAULT '[]',
            examples JSONB DEFAULT '[]',

            -- Configuration
            default_model VARCHAR(50),
            default_temperature FLOAT,
            default_max_tokens INTEGER,

            -- Usage stats
            usage_count INTEGER DEFAULT 0,
            average_rating FLOAT,

            -- Metadata
            description TEXT,
            tags TEXT[],
            is_public BOOLEAN DEFAULT true,
            created_by VARCHAR(50),

            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 18: Create indexes for campaign_ai_prompts
        """
        DO $$
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_prompt_type
            ON campaign_ai_prompts(prompt_type);

            CREATE INDEX IF NOT EXISTS idx_prompt_usage
            ON campaign_ai_prompts(usage_count DESC);
        END $$;
        """
    ]

    async with async_session_maker() as db:
        try:
            print("Running AI and Combat Systems migration...")
            print("=" * 60)

            # Execute each step
            for i, sql in enumerate(migration_steps, 1):
                print(f"Step {i}/{len(migration_steps)}: Executing migration step...")
                await db.execute(text(sql))

            await db.commit()

            print("✅ AI and Combat Systems migration completed successfully!")
            print("=" * 60)

        except Exception as e:
            print(f"❌ Migration failed: {e}")
            await db.rollback()
            raise


async def verify_schema():
    """Verify the new schema was created correctly."""

    tables_to_check = [
        "campaign_chat_channels",
        "campaign_chat_messages",
        "campaign_ai_memory",
        "campaign_combat_agents",
        "campaign_combats",
        "campaign_combat_logs",
        "campaign_agent_strategies",
        "campaign_ai_conversations",
        "campaign_ai_prompts"
    ]

    async with async_session_maker() as db:
        print("\nVerifying AI and Combat Systems schema:")
        print("=" * 60)

        for table_name in tables_to_check:
            query = text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = :table_name
                )
            """)

            result = await db.execute(query, {"table_name": table_name})
            exists = result.scalar()

            if exists:
                print(f"✅ Table '{table_name}' exists")

                # Get column count
                count_query = text("""
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_name = :table_name
                """)
                count_result = await db.execute(count_query, {"table_name": table_name})
                column_count = count_result.scalar()
                print(f"   → {column_count} columns")
            else:
                print(f"❌ Table '{table_name}' does not exist")

        # Check indexes
        print("\n📋 Indexes created:")
        index_query = text("""
            SELECT tablename, indexname
            FROM pg_indexes
            WHERE tablename IN :tables
            ORDER BY tablename, indexname
        """)

        result = await db.execute(index_query, {"tables": tuple(tables_to_check)})
        indexes = result.fetchall()

        current_table = None
        for table, index in indexes:
            if table != current_table:
                print(f"\n  {table}:")
                current_table = table
            print(f"    - {index}")

        print("=" * 60)


async def rollback_migration():
    """Rollback the AI and Combat Systems migration if needed."""

    rollback_steps = [
        "DROP TABLE IF EXISTS campaign_ai_prompts CASCADE;",
        "DROP TABLE IF EXISTS campaign_ai_conversations CASCADE;",
        "DROP TABLE IF EXISTS campaign_agent_strategies CASCADE;",
        "DROP TABLE IF EXISTS campaign_combat_logs CASCADE;",
        "DROP TABLE IF EXISTS campaign_combats CASCADE;",
        "DROP TABLE IF EXISTS campaign_combat_agents CASCADE;",
        "DROP TABLE IF EXISTS campaign_ai_memory CASCADE;",
        "DROP TABLE IF EXISTS campaign_chat_messages CASCADE;",
        "DROP TABLE IF EXISTS campaign_chat_channels CASCADE;"
    ]

    async with async_session_maker() as db:
        try:
            print("Rolling back AI and Combat Systems migration...")
            for sql in rollback_steps:
                await db.execute(text(sql))
            await db.commit()
            print("✅ Rollback completed!")
        except Exception as e:
            print(f"❌ Rollback failed: {e}")
            await db.rollback()
            raise


async def main():
    """Main function."""
    import argparse

    parser = argparse.ArgumentParser(description='Run AI and Combat Systems migration')
    parser.add_argument('--rollback', action='store_true', help='Rollback the migration')
    parser.add_argument('--verify-only', action='store_true', help='Only verify schema without running migration')

    args = parser.parse_args()

    if args.rollback:
        await rollback_migration()
    elif args.verify_only:
        await verify_schema()
    else:
        await run_migration()
        await verify_schema()


if __name__ == "__main__":
    asyncio.run(main())