import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { CreativeSummary } from "@/lib/creative-analytics";

/** Uma estatística secundária só aparece quando o dado existe — nunca um
 * "0"/"—" fabricado pra preencher espaço (degradação graciosa exigida pelo
 * usuário: a interface é orientada pela disponibilidade real do dado). */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * Card de UM criativo (identidade = `creative_name`, o `ad_name` do Meta) —
 * mostra só os indicadores que a fonte de fato entrega pra este cliente.
 * Nunca gated por `performance_goal` da conta (pedido explícito do usuário:
 * o módulo existe independente do objetivo). Sem miniatura de imagem/vídeo
 * (nenhum cache) — o permalink vira um link "Ver no Instagram" quando
 * existir, nunca uma tentativa de embutir a imagem em si.
 */
export function CreativeCard({ summary, detailHref }: { summary: CreativeSummary; detailHref: string }) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <Link
      href={detailHref}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-brand/[0.03]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{summary.creativeName}</p>
        {summary.permalinkUrl && (
          <a
            href={summary.permalinkUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-muted-foreground hover:text-brand"
            aria-label="Ver criativo no Instagram"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.campaignNames.length} {summary.campaignNames.length === 1 ? "campanha" : "campanhas"}
      </p>

      <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-3">
        <Stat label="Investimento" value={formatCurrency(summary.totalSpend)} />
        {goalConfig && summary.totalResultCount !== null && <Stat label={goalConfig.resultMetricLabel} value={String(summary.totalResultCount)} />}
        {goalConfig && summary.cpa !== null && <Stat label={goalConfig.costMetricShortLabel} value={formatCurrency(summary.cpa)} />}
        {summary.totalImpressions !== null && <Stat label="Impressões" value={summary.totalImpressions.toLocaleString("pt-BR")} />}
        {summary.totalReach !== null && <Stat label="Alcance" value={summary.totalReach.toLocaleString("pt-BR")} />}
        {summary.totalClicks !== null && <Stat label="Cliques" value={summary.totalClicks.toLocaleString("pt-BR")} />}
        {summary.ctr !== null && <Stat label="CTR" value={formatPercent(summary.ctr * 100)} />}
        {summary.roas !== null && <Stat label="ROAS" value={`${summary.roas.toFixed(2)}x`} />}
      </div>
    </Link>
  );
}
