-- Add monster_instance_id and token_size fields to tokens table
-- Migration: add_monster_fields_to_tokens
-- Date: 2025-11-02

-- Add monster_instance_id column (nullable, for monster tokens)
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS monster_instance_id INTEGER;

-- Add token_size column (default "1x1")
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS token_size VARCHAR(10) DEFAULT '1x1';

-- Add foreign key constraint for monster_instance_id
ALTER TABLE tokens
ADD CONSTRAINT fk_tokens_monster_instance
FOREIGN KEY (monster_instance_id) 
REFERENCES monster_instances(id) 
ON DELETE CASCADE;

-- Make character_id nullable (since monster tokens don't have character_id)
ALTER TABLE tokens 
ALTER COLUMN character_id DROP NOT NULL;

-- Make user_id nullable (since monster tokens might not have user_id)
ALTER TABLE tokens 
ALTER COLUMN user_id DROP NOT NULL;

-- Add check constraint: either character_id or monster_instance_id must be set
ALTER TABLE tokens
ADD CONSTRAINT check_token_type
CHECK (
    (character_id IS NOT NULL AND monster_instance_id IS NULL) OR
    (character_id IS NULL AND monster_instance_id IS NOT NULL)
);

