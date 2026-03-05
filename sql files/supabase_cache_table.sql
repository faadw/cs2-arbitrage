-- PRICE CACHE TABLE - CS2 Arbitrage
-- Run this in the Supabase SQL Editor.
-- This table caches prices fetched from Steam and CSFloat for up to 15 minutes,
-- so we don't spam the APIs on every item selection.

CREATE TABLE IF NOT EXISTS price_cache (
    hash_name   TEXT PRIMARY KEY,
    steam_price NUMERIC,
    float_price NUMERIC,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Allow the anon client to read and write cached prices
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on price_cache" ON price_cache
    FOR ALL
    USING (true)
    WITH CHECK (true);
