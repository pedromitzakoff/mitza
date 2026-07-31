import { FileDown } from "lucide-react";
import type { AnalyticsPeriodPreset } from "@/lib/analytics";
import { AnalyticsPeriodMenu } from "./analytics-period-menu";

/**
 * Masthead ÚNICO do hub de Analytics — antes, cada seção (Resumo/Criativos)
 * tinha seu próprio cabeçalho + seletor de período repetido; agora existe um
 * só, compartilhado por todas as sub-seções, eliminando a redundância
 * visual pedida pelo usuário.
 *
 * Etapa "Resumo Executivo": "Exportar relatório" NÃO abre mais o wizard do
 * `client_reports` (WhatsApp) — pedido explícito do usuário: são dois
 * produtos diferentes agora. Report (`client_reports`) continua existindo
 * sem alteração nenhuma, só acessível de onde já era (drawer de recorrência
 * "Reportar cliente"); este botão aqui é reservado pra exportação em PDF do
 * Analytics inteiro (Resumo Executivo + Criativos + Campanhas), ainda não
 * implementada — desabilitado até essa exportação existir de verdade, nunca
 * apontando pro wizard antigo por engano.
 */
export function AnalyticsHubHeader({
  baseHref,
  activePreset,
  periodStart,
  periodEnd,
  customStart,
  customEnd,
}: {
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pb-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Analytics</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled
          title="Exportação em PDF chegando em breve"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
          Exportar relatório
          <span className="text-[10px] uppercase tracking-wide">Em breve</span>
        </button>
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
