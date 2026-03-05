-- user settings table
-- Run this in the Supabase SQL Editor to create the table.

CREATE TABLE user_settings (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) DEFAULT auth.uid(),
    steam_balance   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    csfloat_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settings" ON user_settings
    FOR ALL
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
