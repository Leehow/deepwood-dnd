-- Add drawings table for rulers, circles, sketches, and arrows
CREATE TABLE IF NOT EXISTS drawings (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL,
    map_url VARCHAR(1024) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'ruler',
    created_by_user_id VARCHAR(255) NOT NULL,

    -- Ruler fields
    start_x FLOAT,
    start_y FLOAT,
    end_x FLOAT,
    end_y FLOAT,
    distance FLOAT,

    -- Circle fields
    center_x FLOAT,
    center_y FLOAT,
    radius FLOAT,

    -- Sketch/Arrow fields (JSON array of points)
    points JSONB,

    -- Styling
    color VARCHAR(20) NOT NULL DEFAULT '#ff0000',
    stroke_color VARCHAR(20) NOT NULL DEFAULT '#ff0000',
    fill_color VARCHAR(20),
    stroke_width INTEGER NOT NULL DEFAULT 2,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT drawings_pkey PRIMARY KEY (id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS ix_campaign_map_drawings ON drawings(campaign_id, map_url);
CREATE INDEX IF NOT EXISTS ix_drawing_creator ON drawings(created_by_user_id);
