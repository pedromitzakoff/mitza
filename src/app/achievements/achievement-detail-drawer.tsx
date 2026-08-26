"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { formatCurrency, formatDateRange, formatDateTimeWithYear, formatDateWithYear, formatPercent } from "@/lib/format";
import { safeDivide } from "@/lib/performance";
import { yearMonthOf } from "@/lib/achievement-dates";
import { familyLabelFor, ACHIEVEMENT_METRIC_LABEL } from "@/lib/achievement-labels";
import type { AchievementRow } from "@/lib/achievements-data";
import type { AchievementMetricSnapshot } from "@/lib/achievement-types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Formata um valor bruto conforme a unidade da métrica — mesma convenção
 * (currency/ratio/count) já usada em `achievement-client-rules.ts` pra
 * decidir `unit`, nunca uma segunda régua de formatação. */
function formatMetricValue(metric: AchievementMetricSnapshot, value: number): string {
  if (metric.unit === "currency") return formatCurrency(value);
  if (metric.unit === "ratio") return `${value.toFixed(2)}x`;
  return String(Math.round(value));
}

/** Sinal da variação depende da direção "melhor" da métrica — CPA melhora
 * CAINDO, as demais melhoram SUBINDO. Nunca a mesma fórmula pras duas
 * direções (um CPA que sobe seria mostrado como "+X%" de melhora, o
 * oposto do que aconteceu). */
function formatVariation(metric: AchievementMetricSnapshot["metric"], actual: number, comparisonActual: number): string | null {
  if (comparisonActual === 0) return null;
  const rawPct = ((actual - comparisonActual) / comparisonActual) * 100;
  const improvementPct = metric === "cpa" ? -rawPct : rawPct;
  const sign = improvementPct >= 0 ? "+" : "-";
  return `${sign}${formatPercent(Math.abs(improvementPct))}`;
}

/** Data civil (YYYY-MM-DD) a partir de um timestamptz — `occurredAt` grava
 * meio-dia fixo do fuso da agência (ver `persistCandidate`), então extrair
 * só a data (sem reconverter fuso) é o que preserva o dia civil correto. */
function civilDateFromInstant(instant: string): string {
  return instant.slice(0, 10);
}

/**
 * "Detalhes da conquista" (Etapa "Conquistas Auditáveis") — o "comprovante"
 * por trás do card enxuto do feed: período analisado, comparação, os
 * números brutos que formaram o indicador, histórico considerado,
 * sequência, origem/sincronização, e quando aconteceu vs. quando foi
 * detectado. Cada seção só aparece quando o dado correspondente existe no
 * snapshot — nenhuma seção é forçada com "—" pra manter um layout uniforme
 * entre tipos de conquista que não têm a mesma forma (o objetivo é auditoria
 * real, não preencher espaço).
 *
 * Mesmo padrão visual dos demais painéis efêmeros da plataforma
 * (`mitza-backdrop-in`/`mitza-panel-in`, ver `creative-comparison-drawer.tsx`).
 */
export function AchievementDetailDrawer({ achievement, onClose }: { achievement: AchievementRow; onClose: () => void }) {
  const { metric, source } = achievement;
  const hasPeriod = Boolean(metric?.windowStart && metric?.windowEnd);
  const hasComparisonPeriod = Boolean(metric?.comparisonWindowStart && metric?.comparisonWindowEnd);
  const hasComparison = metric?.comparisonActual !== undefined;
  const hasTarget = !hasComparison && metric?.target !== undefined && metric?.target !== null;
  const hasEvidence = Boolean(
    metric && (metric.sampleSpend !== undefined || metric.sampleRevenue || metric.comparisonSpend !== undefined || metric.comparisonRevenue || metric.sampleResultCount !== undefined || metric.comparisonResultCount !== undefined),
  );
  // CPL/CPA "naquele momento" quando a conquista É sobre resultado, não
  // sobre custo (ex.: Meta atingida) — derivado aqui (nunca um campo
  // redundante no snapshot), mesma fórmula (`safeDivide`) usada no resto da
  // plataforma pra CPA.
  const derivedCpa = metric && metric.metric === "result_count" && metric.sampleSpend !== undefined ? safeDivide(metric.sampleSpend, metric.actual) : null;

  const clientMonthHref =
    achievement.scope === "client" && achievement.clientId
      ? `/clients/${achievement.clientId}?month=${yearMonthOf(metric?.windowEnd ?? civilDateFromInstant(achievement.occurredAt))}`
      : null;

  return (
    <>
      <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">
              🏆 {familyLabelFor(achievement.scope, achievement.family)}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold leading-snug text-foreground">{achievement.headline}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {achievement.detail && (
            <Section title="O que aconteceu">
              <p className="text-sm text-foreground">{achievement.detail}</p>
            </Section>
          )}

          {hasPeriod && metric?.windowStart && metric.windowEnd && (
            <Section title="Período analisado">
              <Row label={`Período atual${metric.windowLabel ? ` (${metric.windowLabel})` : ""}`} value={formatDateRange(metric.windowStart, metric.windowEnd)} />
              {hasComparisonPeriod && metric.comparisonWindowStart && metric.comparisonWindowEnd && (
                <Row label="Período comparado" value={formatDateRange(metric.comparisonWindowStart, metric.comparisonWindowEnd)} />
              )}
            </Section>
          )}

          {metric && hasComparison && metric.comparisonActual !== undefined && (() => {
            const comparisonActual = metric.comparisonActual as number;
            const variation = formatVariation(metric.metric, metric.actual, comparisonActual);
            return (
              <Section title="Comparação">
                <Row label={`${ACHIEVEMENT_METRIC_LABEL[metric.metric]} atual`} value={formatMetricValue(metric, metric.actual)} />
                <Row label={`${ACHIEVEMENT_METRIC_LABEL[metric.metric]} anterior`} value={formatMetricValue(metric, comparisonActual)} />
                {variation && <Row label="Variação" value={variation} />}
              </Section>
            );
          })()}

          {metric && hasTarget && metric.target !== undefined && metric.target !== null && (
            <Section title="Meta">
              <Row label="Meta" value={formatMetricValue(metric, metric.target)} />
              <Row label="Resultado" value={formatMetricValue(metric, metric.actual)} />
            </Section>
          )}

          {metric && hasEvidence && (
            <Section title="Dados que formaram o indicador">
              {metric.sampleSpend !== undefined && <Row label="Investimento atual" value={formatCurrency(metric.sampleSpend)} />}
              {Boolean(metric.sampleRevenue) && <Row label="Faturamento atual" value={formatCurrency(metric.sampleRevenue!)} />}
              {metric.sampleResultCount !== undefined && metric.metric !== "result_count" && <Row label="Resultados no período" value={String(metric.sampleResultCount)} />}
              {metric.comparisonSpend !== undefined && <Row label="Investimento anterior" value={formatCurrency(metric.comparisonSpend)} />}
              {Boolean(metric.comparisonRevenue) && <Row label="Faturamento anterior" value={formatCurrency(metric.comparisonRevenue!)} />}
              {metric.comparisonResultCount !== undefined && <Row label="Resultados no período anterior" value={String(metric.comparisonResultCount)} />}
              {derivedCpa !== null && <Row label="CPA naquele momento" value={formatCurrency(derivedCpa)} />}
            </Section>
          )}

          {metric?.historySinceDate && (
            <Section title="Histórico considerado">
              <Row label="Desde" value={formatDateWithYear(metric.historySinceDate)} />
            </Section>
          )}

          {metric?.streakDays !== undefined && (
            <Section title="Sequência">
              <Row label="Dias consecutivos" value={String(metric.streakDays)} />
            </Section>
          )}

          {source && (
            <Section title="Origem">
              <Row label="Canal" value={`${source.channelLabel} · via Stract`} />
              {source.syncedAt && <Row label="Última sincronização utilizada" value={formatDateTimeWithYear(source.syncedAt)} />}
            </Section>
          )}

          <Section title="Quando">
            <Row label="Ocorreu em" value={formatDateWithYear(civilDateFromInstant(achievement.occurredAt))} />
            <Row label="Detectado em" value={formatDateTimeWithYear(achievement.detectedAt)} />
          </Section>

          {clientMonthHref && (
            <Link href={clientMonthHref} className="text-sm font-medium text-brand hover:underline">
              Ver no cliente →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
