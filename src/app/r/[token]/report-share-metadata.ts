import { cache } from "react";
import { resolveAnalyticsPeriod, type AnalyticsPeriod } from "@/lib/analytics";
import { resolveClientIdFromShareToken } from "@/lib/report-share-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayDateString } from "@/lib/today";

/**
 * Etapa "OG Metadata do Relatório Público": dado mínimo e seguro pra
 * alimentar o preview de compartilhamento (`generateMetadata`/
 * `opengraph-image.tsx`) — NUNCA a pipeline pesada do relatório
 * (`buildPerformanceReportData`/`buildPerformanceReportDocument`, que
 * carrega métrica), só o nome do cliente. Resolve o token pela MESMA
 * função de sempre (`resolveClientIdFromShareToken`) — token inexistente,
 * revogado ou cliente já excluído seguem indistinguíveis (`null`), mesmo
 * comportamento neutro de sempre. `cache()` evita repetir a consulta
 * quando `generateMetadata` e a página chamam com o mesmo token dentro do
 * mesmo request (padrão recomendado pelo Next.js pra dado usado nos dois
 * lugares).
 */
export const resolveReportShareClientName = cache(async (token: string): Promise<string | null> => {
  const clientId = await resolveClientIdFromShareToken(token);
  if (!clientId) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (error || !data) return null;

  return data.name;
});

/**
 * Período padrão do preview de compartilhamento — sempre "this_month",
 * independente de query string (`analyticsPreset`/`analyticsStart`/
 * `analyticsEnd`): o link compartilhado é a URL nua do token, e
 * `opengraph-image.tsx` (convenção de arquivo do Next.js) só recebe
 * `params`, nunca `searchParams` — usar o mesmo período fixo nos dois
 * lugares (texto e imagem) evita qualquer divergência entre eles.
 */
export function resolveReportShareDefaultPeriod(): AnalyticsPeriod {
  return resolveAnalyticsPeriod(undefined, todayDateString());
}

const periodMonthYearFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const periodDayMonthFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isFullCalendarMonth(period: AnalyticsPeriod): boolean {
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  const lastDayOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return start.getUTCDate() === 1 && end.getTime() === lastDayOfMonth.getTime();
}

/**
 * "Setembro 2026" pra período de mês fechado (o caso padrão, "this_month");
 * "01/09 – 07/09" pra qualquer outro recorte — nunca expõe métrica, só a
 * janela de tempo do relatório.
 */
export function formatReportPeriodLabel(period: AnalyticsPeriod): string {
  if (isFullCalendarMonth(period)) {
    const [month, year] = periodMonthYearFormatter.format(new Date(`${period.start}T00:00:00Z`)).split(" de ");
    return `${capitalize(month)} ${year}`;
  }
  const start = periodDayMonthFormatter.format(new Date(`${period.start}T00:00:00Z`));
  const end = periodDayMonthFormatter.format(new Date(`${period.end}T00:00:00Z`));
  return `${start} – ${end}`;
}
