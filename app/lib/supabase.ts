import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const url = viteEnv.NEXT_PUBLIC_SUPABASE_URL ?? viteEnv.VITE_SUPABASE_URL;
const publicKey = viteEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? viteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? viteEnv.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && publicKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(url!, publicKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
