import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { CreativeSummary } from "@/lib/creative-analytics";
import { CreativeThumbnail } from "./creative-thumbnail";

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
 * o módulo existe independente do objetivo).
 *
 * Ajuste "representação visual dos criativos": a MINIATURA (`CreativeThumbnail`,
 * hoje sempre placeholder — `preview_image_url` ainda não é preenchido
 * por nenhum mecanismo) é o elemento visual principal do card, nunca o
 * permalink. O permalink vira uma ação SECUNDÁRIA ("Abrir no Instagram"),
 * nunca a representação do criativo em si.
 *
 * O card inteiro é clicável (vai pro detalhe) via um `<Link>` absoluto que
 * cobre o container — o link do permalink fica ACIMA dele (`z-10`), como
 * irmão, nunca aninhado dentro de outro `<a>` (HTML inválido).
 */
export function CreativeCard({ summary, detailHref }: { summary: CreativeSummary; detailHref: string }) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <div className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-brand/[0.03]">
      <Link href={detailHref} className="absolute inset-0 rounded-lg" aria-label={`Ver detalhes de ${summary.creativeName}`} />

      <CreativeThumbnail url={summary.previewImageUrl} alt={summary.creativeName} />

      <div>
        <p className="truncate text-sm font-semibold text-foreground">{summary.creativeName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.campaignNames.length} {summary.campaignNames.length === 1 ? "campanha" : "campanhas"}
        </p>
      </div>

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

      {summary.permalinkUrl && (
        <a
          href={summary.permalinkUrl}
          target="_blank"
          rel="noreferrer"
          className="relative z-10 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Abrir no Instagram
        </a>
      )}
    </div>
  );
}
