import Link from "next/link";
import { FileText } from "lucide-react";
import type { AnalyticsPeriodPreset } from "@/lib/analytics";
import { AnalyticsPeriodMenu } from "./analytics-period-menu";

/**
 * Masthead ÚNICO do hub de Analytics — antes, cada seção (Resumo/Criativos)
 * tinha seu próprio cabeçalho + seletor de período repetido; agora existe um
 * só, compartilhado por todas as sub-seções (Resumo/Criativos/Campanhas),
 * eliminando a redundância visual pedida pelo usuário. `newReportHref` abre
 * o wizard já existente do `client_reports` (WhatsApp) — o módulo continua
 * existindo intacto, só deixou de ser uma área própria da plataforma e
 * virou uma ação aqui dentro ("Gerar relatório"), como pedido.
 */
export function AnalyticsHubHeader({
  baseHref,
  activePreset,
  periodStart,
  periodEnd,
  customStart,
  customEnd,
  newReportHref,
}: {
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
  newReportHref: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pb-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Analytics</p>
      <div className="flex items-center gap-2">
        <Link
          href={newReportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Gerar relatório
        </Link>
        <AnalyticsPeriodMenu
          baseHref={baseHref}
          activePreset={activePreset}
          periodStart={periodStart}
          periodEnd={periodEnd}
          customStart={customStart}
          customEnd={customEnd}
        />
      </div>
    </div>
  );
}
