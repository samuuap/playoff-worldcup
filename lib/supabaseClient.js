'use client';
import { createClient } from '@supabase/supabase-js';

// La sesión se guarda automáticamente (persistSession) entre recargas.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
