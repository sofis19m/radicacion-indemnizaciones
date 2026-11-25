import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cliente: SupabaseClient | null = null;

/** Cliente con service role. Solo se usa en el servidor; nunca llega al navegador. */
export function db(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}
