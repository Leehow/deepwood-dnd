-- Add instance_name and current_hp fields to tokens table
-- Migration for supporting multiple monster instances with independent HP

ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS instance_name VARCHAR(100);

ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS current_hp INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN tokens.instance_name IS 'Display name for token instance (e.g., "地精1", "地精2")';
COMMENT ON COLUMN tokens.current_hp IS 'Current HP for this token instance (independent for each monster instance)';

