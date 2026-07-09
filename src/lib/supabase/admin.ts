import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente com a service role key — ignora RLS. Uso restrito a código de
 * servidor de confiança (scripts, sync com o Meta, rotas de cron), nunca
 * exposto ao browser e nunca a partir de input não validado do usuário.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
