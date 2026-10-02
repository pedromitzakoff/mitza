import { formatCurrency, formatCount, formatShortDate } from "@/lib/format";
import type { MetasRow, MetasRowUnit } from "@/lib/metas-table";
import type { MetricTone } from "@/lib/metric-diagnostics";

/**
 * "RESUMO DAS METAS" — hero section do módulo Metas (Etapa "MEGA FACELIFT
 * — Fase 2"). Visualização inspirada conceitualmente num plano mensal
 * virando trajetória diária, mas construída só com tokens/cores já
 * existentes do design system MITZA (`overview-*`, `TONE_CLASSES` no mesmo
 * espírito de `performance-diagnostic.tsx`) — nenhuma linguagem visual
 * nova.
 *
 * Colunas Indicador/Meta/Realizado ficam `sticky` (scroll horizontal só
 * move os dias) — primeira leitura (o que importa, de cara) nunca sai de
 * vista mesmo num mês de 31 dias.
 *
 * CORREÇÃO (bug visual de produção — scroll horizontal vazando por trás do
 * bloco sticky): a causa raiz era `table-layout: auto` (implícito, nenhum
 * `table-fixed`) combinado com `left-[140px]`/`left-[260px]` CHUTADOS —
 * rótulos reais mais longos que "Indicador" (ex.: `PERFORMANCE_GOALS.
 * followers.costMetricLabel = "Custo por novo seguidor"`, lib/performance-goals.ts)
 * faziam o navegador alargar a 1ª coluna muito além de 140px (o browser
 * dimensiona colunas pelo conteúdo mais largo da tabela inteira sob
 * `table-layout: auto`), então a 2ª/3ª coluna sticky ficavam fixadas num
 * `left` que não correspondia à borda real da coluna anterior — abrindo uma
 * fresta onde o conteúdo rolável (dias) ficava visível por cima/entre as
 * colunas fixas. Correção estrutural, não um ajuste de margem: `table-fixed`
 * (larguras SEMPRE as de `STICKY_COLUMN_WIDTH`/`DAY_COLUMN_WIDTH`,
 * independente do conteúdo) + `<colgroup>` (header e body herdam a MESMA
 * largura, nunca duas fontes de verdade) + `left` de cada coluna sticky
 * DERIVADO por soma cumulativa das larguras anteriores (nunca mais um valor
 * escrito à mão sem relação com a largura real). Rótulo que ainda não
 * couber trunca com ellipsis (`title` preserva o texto completo no hover) —
 * nunca estoura a largura da coluna e desloca o resto da tabela.
 *
 * `border-collapse` trocado por `border-separate` + `border-spacing-0`: sob
 * `collapse`, a borda de uma coluna sticky podia ser "roubada"/repintada
 * pela célula rolável vizinha ao cruzar o mesmo pixel de borda durante o
 * scroll (artefato conhecido de `sticky` + `border-collapse` entre
 * navegadores) — `separate` dá a cada célula sua própria borda, sem
 * compartilhar pixel com a vizinha. Efeito colateral necessário: borda
 * (`border-collapse` só respeita borda em `td`/`th`, nunca em `tr`) migrou
 * de `<tr>` pra cada célula.
 */

const TONE_TEXT_CLASSES: Record<MetricTone, string> = {
  critical: "text-red-700 dark:text-red-400",
  attention: "text-amber-700 dark:text-amber-400",
  normal: "text-overview-text-primary",
};

function formatValue(value: number | null, unit: MetasRowUnit): string {
  if (value === null) return "—";
  if (unit === "currency") return formatCurrency(value);
  if (unit === "ratio_x") return `${value.toFixed(1)}x`;
  return formatCount(Math.round(value));
}

/** Única fonte de verdade das larguras — tanto o `<colgroup>` quanto o
 * `left` de cada coluna sticky (calculado abaixo por soma cumulativa) saem
 * destes 3 números. Nunca escrever um `left-[...]` à mão de novo: qualquer
 * mudança de largura aqui já propaga pro offset certo. 190px comporta o
 * rótulo mais longo hoje ("Custo por novo seguidor", objetivo Seguidores)
 * sem ellipsis; o truncamento continua como rede de segurança pra um rótulo
 * futuro ainda mais longo. */
const STICKY_COLUMN_WIDTH = {
  indicador: 190,
  meta: 110,
  realizado: 130,
} as const;

/** 104px — comporta o valor diário mais largo visto em produção (moeda, ex.:
 * "R$ 4.643,02") com folga, sem vazar pra célula vizinha. 64px (valor
 * original) só cabia o cabeçalho curto ("01/10"); sob `table-fixed` o
 * conteúdo que não cabe NUNCA empurra a coluna (diferença chave do
 * `table-layout: auto` de antes) — ele teria que vazar visualmente por cima
 * da célula seguinte, que é exatamente o segundo bug reportado (achado em
 * produção: "86", "R$ 4.643,02" etc. sobrepondo a coluna seguinte).
 * `overflow-hidden`/ellipsis nas células de dia (abaixo) continuam como rede
 * de segurança pra um valor futuro ainda maior, nunca a solução principal —
 * a largura certa é sempre a primeira linha de defesa. */
const DAY_COLUMN_WIDTH = 104;

const STICKY_LEFT = {
  indicador: 0,
  meta: STICKY_COLUMN_WIDTH.indicador,
  realizado: STICKY_COLUMN_WIDTH.indicador + STICKY_COLUMN_WIDTH.meta,
} as const;

/** `bg-overview-surface` opaco é o que impede o conteúdo rolável de
 * aparecer por baixo; `z-10` garante que a coluna sticky pinta ACIMA das
 * células de dia (z-index padrão `auto`) na mesma linha. `box-border`
 * evita que `padding`/`border` somem à largura fixa do `<col>` (largura
 * final sempre exatamente `STICKY_COLUMN_WIDTH.*`, nunca um pixel maior). */
const STICKY_COL_CLASSES = "sticky z-10 box-border bg-overview-surface";
const TRUNCATE_CLASSES = "overflow-hidden text-ellipsis whitespace-nowrap";

export function MetasSummaryTable({ rows }: { rows: MetasRow[] }) {
  if (rows.length === 0) return null;

  const days = rows[0].days;

  // `table-layout: fixed` + `<colgroup>` só é respeitado PIXEL A PIXEL quando
  // a própria `<table>` tem uma largura explícita e determinística — sem
  // `width` (auto) OU com `width: max-content`, o Chromium ainda redistribui
  // espaço extra entre algumas colunas (comprovado por medição real via
  // `getBoundingClientRect`: com `width` ausente, "Meta do mês" renderizava
  // 114px em vez dos 110px pedidos, e os dias 78px em vez de 64px — nenhuma
  // relação visível com o conteúdo de cada um, só uma redistribuição interna
  // do algoritmo "fixed" do navegador). Essa é a MESMA causa raiz do bug
  // original (offset sticky descasado da largura real), só que um nível mais
  // fundo — por isso a largura total é somada aqui, a partir das MESMAS
  // constantes que já alimentam `<colgroup>`/`left`, nunca um número novo.
  const totalTableWidth = STICKY_COLUMN_WIDTH.indicador + STICKY_COLUMN_WIDTH.meta + STICKY_COLUMN_WIDTH.realizado + days.length * DAY_COLUMN_WIDTH;

  return (
    <div className="overflow-x-auto rounded-lg border border-overview-border">
      <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: totalTableWidth }}>
        <colgroup>
          <col style={{ width: STICKY_COLUMN_WIDTH.indicador }} />
          <col style={{ width: STICKY_COLUMN_WIDTH.meta }} />
          <col style={{ width: STICKY_COLUMN_WIDTH.realizado }} />
          {days.map((day) => (
            <col key={day.date} style={{ width: DAY_COLUMN_WIDTH }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-overview-surface-subtle">
            <th
              style={{ left: STICKY_LEFT.indicador, width: STICKY_COLUMN_WIDTH.indicador }}
              className={`${STICKY_COL_CLASSES} border-b border-overview-border bg-overview-surface-subtle px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}
            >
              Indicador
            </th>
            <th
              style={{ left: STICKY_LEFT.meta, width: STICKY_COLUMN_WIDTH.meta }}
              className={`${STICKY_COL_CLASSES} border-b border-overview-border bg-overview-surface-subtle px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}
            >
              Meta do mês
            </th>
            <th
              style={{ left: STICKY_LEFT.realizado, width: STICKY_COLUMN_WIDTH.realizado }}
              className={`${STICKY_COL_CLASSES} border-b border-r border-overview-border bg-overview-surface-subtle px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}
            >
              Realizado
            </th>
            {days.map((day) => (
              <th
                key={day.date}
                className={`${TRUNCATE_CLASSES} border-b border-overview-border px-2 py-2 text-right text-[11px] font-medium tabular-nums ${
                  day.isFuture ? "text-overview-text-muted" : "text-overview-text-secondary"
                }`}
              >
                {formatShortDate(day.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const isLastRow = rowIndex === rows.length - 1;
            const rowBorderClass = isLastRow ? "" : "border-b border-overview-border";
            return (
              <tr key={row.key}>
                <td
                  style={{ left: STICKY_LEFT.indicador, width: STICKY_COLUMN_WIDTH.indicador }}
                  className={`${STICKY_COL_CLASSES} ${rowBorderClass} ${TRUNCATE_CLASSES} px-3 py-2 font-medium text-overview-text-primary`}
                  title={row.label}
                >
                  {row.label}
                </td>
                <td
                  style={{ left: STICKY_LEFT.meta, width: STICKY_COLUMN_WIDTH.meta }}
                  className={`${STICKY_COL_CLASSES} ${rowBorderClass} ${TRUNCATE_CLASSES} px-3 py-2 text-right tabular-nums text-overview-text-secondary`}
                  title={formatValue(row.targetMonth, row.unit)}
                >
                  {formatValue(row.targetMonth, row.unit)}
                </td>
                <td
                  style={{ left: STICKY_LEFT.realizado, width: STICKY_COLUMN_WIDTH.realizado }}
                  className={`${STICKY_COL_CLASSES} ${rowBorderClass} ${TRUNCATE_CLASSES} border-r border-overview-border px-3 py-2 text-right tabular-nums`}
                  title={formatValue(row.realizedMonth, row.unit)}
                >
                  <span className={`font-semibold ${TONE_TEXT_CLASSES[row.tone]}`}>{formatValue(row.realizedMonth, row.unit)}</span>
                  {row.unavailableNote && (
                    <p className="mt-0.5 whitespace-normal text-[10px] font-normal text-overview-text-muted">{row.unavailableNote}</p>
                  )}
                </td>
                {row.days.map((day) => (
                  <td
                    key={day.date}
                    className={`${rowBorderClass} ${TRUNCATE_CLASSES} px-2 py-2 text-right tabular-nums ${
                      day.isNeededRate
                        ? "bg-overview-surface-subtle text-overview-text-muted"
                        : day.isFuture
                          ? "text-overview-text-muted"
                          : "text-overview-text-secondary"
                    }`}
                    title={day.isNeededRate ? "Ritmo necessário a partir de hoje" : formatValue(day.value, row.unit)}
                  >
                    {formatValue(day.value, row.unit)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
