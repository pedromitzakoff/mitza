import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { ReportThemeDb } from "@/lib/supabase/database.types";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada 3 do AnalyticsReport — configuração visual pura. O Renderer (Camada
 * 4) NUNCA lê `theme.id` pra decidir o que desenhar, só os campos abaixo —
 * mesmo padrão de `PERFORMANCE_GOALS` (`lib/performance-goals.ts`): um tema
 * novo é só uma entrada nova em `REPORT_THEMES`, zero mudança no renderer.
 */
export interface ReportTheme {
  id: ReportThemeDb;
  /** `null` = White Label, nenhum nome de marca aparece no documento. */
  brandName: string | null;
  /** `null` = sem asset definitivo ainda; renderer cai pro fallback textual
   * (mesmo padrão de degradação graciosa de `CreativeThumbnail`). */
  logoUrl: string | null;
  accentColor: string;
  showCoverBranding: boolean;
  /** `null` = sem rodapé institucional. */
  footerText: string | null;
}

export const REPORT_THEMES: Record<ReportThemeDb, ReportTheme> = {
  mitza: {
    id: "mitza",
    brandName: "MITZA",
    logoUrl: null,
    // Etapa "Identidade Visual KOFF": era o azul antigo da marca (#4169E1)
    // — o relatório exportado (HTML/PDF, renderer isolado, não lê os
    // tokens de globals.css) precisa da MESMA atualização à parte pra não
    // ficar com uma identidade desatualizada em relação à plataforma ao
    // vivo. `id`/`brandName` continuam "mitza"/"MITZA" (renomear a marca é
    // decisão de produto/schema, fora do escopo desta migração visual).
    accentColor: "#1C1C1C",
    showCoverBranding: true,
    footerText: "Gerado por MITZA Analytics",
  },
  white_label: {
    id: "white_label",
    brandName: null,
    logoUrl: null,
    accentColor: "#18181B",
    showCoverBranding: false,
    footerText: null,
  },
};

/** Lê `clients.report_theme` — tema pertence ao domínio do cliente, não ao
 * botão de exportação. Sem UI de seleção ainda (todo cliente nasce
 * `'mitza'`), mas a resolução já lê a coluna real desde a Fase 1. */
export async function resolveReportTheme(supabase: Supabase, clientId: string): Promise<ReportTheme> {
  const rows = await requireQuery(supabase.from("clients").select("report_theme").eq("id", clientId), "clients:report-theme");
  const themeId = rows[0]?.report_theme ?? "mitza";
  return REPORT_THEMES[themeId];
}
