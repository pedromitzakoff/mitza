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
 *
 * Etapa "Análise de Criativos": duas mudanças mínimas em cima do card que já
 * estava certo.
 *   1. Alinhamento do resultado/custo — quando a conta tem objetivo
 *      configurado (`goalConfig`), os dois slots SEMPRE aparecem (com "—"
 *      quando este criativo em particular não teve resultado), nunca somem
 *      condicionalmente — evita a impressão de "layout quebrado" num
 *      criativo sem venda ao lado de outros que têm.
 *   2. Checkbox de comparação — opcional/retrocompatível (`selectable`
 *      default `false`): sem essas props o card continua idêntico a antes.
 */
export function CreativeCard({
  summary,
  detailHref,
  selectable = false,
  selected = false,
  selectionDisabled = false,
  onToggleSelect,
}: {
  summary: CreativeSummary;
  detailHref: string;
  selectable?: boolean;
  selected?: boolean;
  /** `true` quando já há 3 criativos selecionados e este não é um deles —
   * nunca desmarca sozinho, só impede marcar um 4º. */
  selectionDisabled?: boolean;
  onToggleSelect?: () => void;
}) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-brand/[0.03]">
      <Link href={detailHref} className="absolute inset-0 rounded-lg" aria-label={`Ver detalhes de ${summary.creativeName}`} />

      {selectable && (
        <label
          className={`absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md border border-border bg-card/95 px-1.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-opacity ${
            // QA final: sempre visível abaixo de `sm:` — toque não tem
            // estado de hover, então "só aparece no hover" deixaria a
            // comparação inacessível no mobile. Continua discreto (hover-only)
            // a partir de `sm:`, onde mouse é a interação predominante.
            selected
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:has-[:focus-visible]:opacity-100"
          }`}
        >
          <input
            type="checkbox"
            checked={selected}
            disabled={selectionDisabled}
            onChange={onToggleSelect}
            aria-label={`Comparar ${summary.creativeName}`}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
          />
          Comparar
        </label>
      )}

      <CreativeThumbnail url={summary.previewImageUrl} alt={summary.creativeName} />

      <div>
        <p className="truncate text-sm font-semibold text-foreground">{summary.creativeName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.campaignNames.length} {summary.campaignNames.length === 1 ? "campanha" : "campanhas"}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-3">
        <Stat label="Investimento" value={formatCurrency(summary.totalSpend)} />
        {goalConfig && (
          <Stat label={goalConfig.resultMetricLabel} value={summary.totalResultCount !== null ? String(summary.totalResultCount) : "—"} />
        )}
        {goalConfig && <Stat label={goalConfig.costMetricShortLabel} value={summary.cpa !== null ? formatCurrency(summary.cpa) : "—"} />}
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
