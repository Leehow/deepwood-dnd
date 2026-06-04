# Deprecated Migration Scripts

This directory contains migration scripts that have been **superseded by Alembic** and are kept only for historical reference.

## ⚠️ DO NOT USE THESE SCRIPTS

All database migrations should now be managed through Alembic:

```bash
cd backend
./venv/bin/alembic upgrade head
```

## Migration Status

### ✅ Already Migrated by Alembic

These scripts created tables/columns that are now managed by Alembic revisions:

- **campaign_storage** and **campaign_storage_acl** tables
  - Created by: `add_flexible_campaign_storage.py`
  - Now managed by: Alembic revision `add_campaign_storage` and `add_campaign_storage_acl2`
  - Status: ✅ Tables exist in database

- **ai_model_configs** table
  - Created by: `refactor_ai_settings_normalization.py`
  - Now managed by: Alembic (part of AI settings 3NF refactoring)
  - Status: ✅ Table exists in database

- **campaigns.metadata** column
  - Created by: `run_campaigns_metadata_jsonb.py`
  - Now managed by: Alembic revision `add_campaigns_metadata_jsonb`
  - Status: ✅ Column exists in database

- **campaign_members.selected_character_id** column
  - Created by: `run_migration.py`
  - Now managed by: Alembic revision `add_selected_character`
  - Status: ✅ Column exists in database

### ❌ Not Yet Migrated (Future Work)

These scripts create tables that are **not yet in Alembic** and **not yet in the database**:

- **AI Chat and Combat System** (`add_ai_chat_and_combat_systems.py`)
  - Tables: `campaign_chat_channels`, `campaign_chat_messages`, `campaign_combats`, etc.
  - Status: ❌ Tables do not exist
  - Action needed: If these features are needed, create Alembic revisions

### 🗑️ One-time Data Migrations (Completed)

These scripts were used for one-time data migrations and are no longer needed:

- `migrate_redis_to_db.py` - Migrated selected character data from Redis to PostgreSQL
- `migrate_ai_settings.py` - Migrated AI settings to global configuration
- `migrate_campaign_members_user_ids.py` - Migrated user IDs from 'user_X' to 'X' format
- `migrate_campaign_user_ids.py` - Migrated campaign dm_user_id format
- `migrate_characters_user_ids.py` - Migrated character user IDs
- `run_quest_progress_to_campaign_storage.py` - Migrated quest progress from JSON files to database
- `fix_enum_values.py` - Fixed enum values to uppercase (one-time fix)

### 🔧 Utility Scripts

- `debug_check_db.py` - Debug script with hardcoded paths (dev-only)

### 📦 Archived Migration Scripts (Superseded by Alembic)

These scripts created tables/features that are now managed by Alembic:

- `add_flexible_campaign_storage.py` - Created campaign_storage system (now in Alembic)
- `refactor_ai_settings_normalization.py` - Refactored AI settings to 3NF (now in Alembic)
- `add_ai_chat_and_combat_systems.py` - AI chat/combat tables (not yet implemented)

## Archived SQL Files

The following SQL files were also moved here:

- `add_drawings_table.sql`
- `add_monster_fields_to_tokens.sql`
- `add_selected_character_id.sql`
- `add_token_instance_fields.sql`
- `add_translation_music_models.sql`
- `create_monster_avatars_table.sql`

These were ad-hoc SQL scripts that have been replaced by Alembic migrations.

## Cleanup Recommendations

1. **Keep for reference**: All scripts should be kept for historical reference and understanding of how the database evolved.

2. **Future cleanup**: After confirming all migrations are stable in production, these scripts can be:
   - Moved to a separate archive repository
   - Or deleted if version control history is sufficient

3. **New features**: If AI chat/combat features are needed:
   - Create proper Alembic revisions instead of using `add_ai_chat_and_combat_systems.py`
   - Follow the established Alembic workflow

## Migration History

- **2025-11-07**: Unified all migrations to Alembic, deprecated manual scripts
- **2025-11-06**: Refactored AI settings to 3NF
- **2025-11-02 - 2025-11-05**: Various ad-hoc migrations before Alembic standardization
