// Initialize the Supabase client for database operations.
// This uses the public "anon" key, which is safe to include in client-side code
// because Row Level Security (RLS) on each table controls what reads/writes are allowed.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mmsdxdqleskevmbumbzy.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tc2R4ZHFsZXNrZXZtYnVtYnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NTYzNzYsImV4cCI6MjA4ODAzMjM3Nn0.9FYZIn3EPrG7LgP4HtTZ1MJeizHECrfGcLPGXwuvWv4'

export const supabase = createClient(supabaseUrl, supabaseKey)