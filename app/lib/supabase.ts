import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const url = viteEnv.NEXT_PUBLIC_SUPABASE_URL ?? viteEnv.VITE_SUPABASE_URL;
const anonKey = viteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? viteEnv.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
