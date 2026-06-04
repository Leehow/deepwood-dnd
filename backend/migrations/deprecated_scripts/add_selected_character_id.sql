-- Migration: Add selected_character_id to campaign_members table
-- Date: 2025-11-02

-- Add the column
ALTER TABLE campaign_members 
ADD COLUMN selected_character_id INTEGER;

-- Add foreign key constraint
ALTER TABLE campaign_members
ADD CONSTRAINT fk_campaign_members_selected_character
FOREIGN KEY (selected_character_id) 
REFERENCES characters(id) 
ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX ix_campaign_members_selected_character_id 
ON campaign_members(selected_character_id);

-- Migrate data from Redis to database (manual step required)
-- Run the Python script: python migrate_redis_to_db.py

