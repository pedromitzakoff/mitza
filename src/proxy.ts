import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas, exceto assets estáticos, a própria imagem
     * otimizada do Next.js e rotas de API (`/api/*`) — essas nunca são
     * chamadas por um navegador com sessão de gestor logado (são
     * server-to-server: cron da Vercel, integrações, chamadas
     * administrativas diretas) e já têm sua própria proteção
     * (`CRON_SECRET`, ver `/api/cron/*` e `/api/admin/*`). Bug descoberto na
     * validação da integração Stract: sem esta exclusão, toda chamada sem
     * cookie de sessão a `/api/*` era redirecionada pro `/login` antes de
     * chegar no handler — isso já afetava silenciosamente `/api/cron/sync-meta`
     * também, só nunca detectado porque aquele cron nunca chegou a ser
     * ativado de verdade em produção.
     */
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
