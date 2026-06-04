-- Add translation and music model settings to ai_api_settings table

-- Add Advanced Translation Model fields
ALTER TABLE ai_api_settings 
ADD COLUMN IF NOT EXISTS translation_api_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS translation_api_key TEXT,
ADD COLUMN IF NOT EXISTS translation_model VARCHAR(100);

-- Add Music Generation Model fields
ALTER TABLE ai_api_settings 
ADD COLUMN IF NOT EXISTS music_api_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS music_api_key TEXT,
ADD COLUMN IF NOT EXISTS music_model VARCHAR(100);

