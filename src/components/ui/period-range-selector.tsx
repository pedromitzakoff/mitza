"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  addDaysToDateString,
  buildCalendarWeeks,
  calendarMonthFromDateString,
  formatCompactPeriodLabel,
  isValidDateRange,
  resolveRangeClick,
  shiftCalendarMonth,
  WEEKDAY_SHORT_LABELS_PT_BR,
  type CalendarMonth,
  type DateRangeDraft,
} from "@/lib/date-range-picker";

/**
 * Etapa "Padronização Global dos Seletores de Período" (Fase 1) —
 * componente canônico de período, modo `range` (modos `month`/`single-date`
 * ficam pra uma etapa futura). Comportamento inspirado no Meta Ads
 * (presets + calendário de 2 meses + rascunho local só aplicado em
 * "Aplicar"), identidade 100% KOFF (creme/areia/grafite/branco/verde-limão
 * — nunca a paleta azul do Meta).
 *
 * Etapa "Otimização Mobile do Performance Report": abaixo de `sm` (640px)
 * o painel deixa de ser um dropdown ancorado no trigger (a auditoria
 * mobile confirmou até 94px do painel renderizados FORA da borda esquerda
 * da viewport em 320px — `right-0` só funciona quando o trigger já está
 * perto da borda direita) e vira um bottom sheet fixo (`fixed inset-x-0
 * bottom-0`, cantos superiores arredondados, com backdrop) — presets em
 * lista vertical de largura cheia, 1 calendário (o 2º mês continua oculto
 * no mobile), rodapé Cancelar/Aplicar sempre fixo (nunca rola pra fora da
 * tela). Em `sm+` nada muda: mesmo dropdown de sempre, dois calendários,
 * presets em coluna lateral. Único componente afetado é este — usado
 * SÓ por `ReportPeriodControl` (relatório interno + link público), nenhum
 * outro seletor de período da MITZA importa `PeriodRangeSelector`.
 *
 * Desenho de API: `value` é sempre o período JÁ APLICADO (a URL continua
 * sendo a fonte de verdade — quem usa este componente resolve `value` a
 * partir da URL, nunca o inverso). Abrir o popover copia `value` pra um
 * rascunho local (`draft`); todo clique em preset/calendário só muda o
 * rascunho; `onApply` só dispara ao clicar em "Aplicar", e é
 * responsabilidade de quem usa decidir o que fazer com o resultado (nesta
 * etapa: `router.push` numa nova URL — ver `ReportPeriodControl`). Não
 * anexa `presetKey` a `value` porque o preset ativo é sempre DERIVADO
 * comparando `value` contra `presets` — nunca um segundo estado paralelo
 * que possa divergir da URL.
 */

export interface PeriodRangePreset {
  /** Opaco pra este componente — o consumidor decide o vocabulário (ex.:
   * os valores de `AnalyticsPeriodPreset`). Devolvido em `onApply` quando o
   * intervalo aplicado bate exatamente com este preset. */
  key: string;
  label: string;
  range: { start: string; end: string };
}

export interface PeriodRangeSelectorProps {
  value: { start: string; end: string };
  /** Ordem de exibição na coluna de presets — o consumidor decide quais
   * (e quantos) aparecem; nunca uma lista fixa forçada por este componente. */
  presets: PeriodRangePreset[];
  onApply: (next: { start: string; end: string; presetKey: string | null }) => void;
  /** `YYYY-MM-DD` — usado pra destacar "hoje" no calendário e decidir
   * quando omitir o ano no rótulo compacto. */
  today: string;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
}

function matchPreset(range: { start: string; end: string }, presets: PeriodRangePreset[]): PeriodRangePreset | null {
  return presets.find((preset) => preset.range.start === range.start && preset.range.end === range.end) ?? null;
}

// Etapa "Otimização Mobile" (ajuste pós-produção): usuário pediu
// explicitamente o MESMO layout do desktop no mobile (presets à esquerda,
// calendário à direita, lado a lado), só reduzido — não mais empilhado.
// Isso muda a conta de largura: o calendário de 7 colunas precisa de pelo
// menos 7×32px = 224px pra os dias não se sobreporem entre si (célula mais
// estreita que o próprio botão), e essa largura tem que sobrar espaço pra
// coluna de presets do lado. Por isso os dias voltam a 32px SEMPRE (igual
// ao desktop) — 40px só cabia no layout empilhado antigo, que dava a
// largura da tela inteira pro calendário.
const DAY_BUTTON_BASE = "flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors";

function CalendarMonthGrid({
  month,
  draft,
  today,
  minDate,
  maxDate,
  onSelect,
  onKeyNavigate,
  onPrev,
  onNext,
  className,
}: {
  month: CalendarMonth;
  draft: DateRangeDraft;
  today: string;
  minDate?: string;
  maxDate?: string;
  onSelect: (date: string) => void;
  onKeyNavigate: (date: string, key: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}) {
  const weeks = useMemo(() => buildCalendarWeeks(month.year, month.monthIndex), [month.year, month.monthIndex]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(Date.UTC(month.year, month.monthIndex, 1)),
      ),
    [month.year, month.monthIndex],
  );

  return (
    <div className={`flex w-56 shrink-0 flex-col gap-2 max-[359px]:w-full ${className ?? ""}`}>
      <div className="flex items-center justify-between px-1">
        {onPrev ? (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Mês anterior"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#17171A] hover:bg-[#EFE9E0]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-8 w-8" aria-hidden="true" />
        )}
        <span className="text-sm font-semibold capitalize text-[#17171A]">{monthLabel}</span>
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Próximo mês"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#17171A] hover:bg-[#EFE9E0]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-8 w-8" aria-hidden="true" />
        )}
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_SHORT_LABELS_PT_BR.map((label) => (
          <span key={label} className="text-[11px] font-medium uppercase text-[#6F6B65]">
            {label}
          </span>
        ))}

        {weeks.flat().map((cell) => {
          const isStart = draft.start === cell.date;
          const isEnd = draft.end === cell.date;
          const isBoundary = isStart || isEnd;
          const inRange = Boolean(draft.start && draft.end && cell.date >= draft.start && cell.date <= draft.end);
          const isToday = cell.date === today;
          const isDisabled = (minDate !== undefined && cell.date < minDate) || (maxDate !== undefined && cell.date > maxDate);

          return (
            <div key={cell.date} className={`relative ${inRange && !isBoundary ? "bg-[#EFE9E0]" : ""}`}>
              <button
                type="button"
                data-date={cell.date}
                disabled={isDisabled}
                onClick={() => onSelect(cell.date)}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    onKeyNavigate(cell.date, event.key);
                  }
                }}
                aria-pressed={isBoundary}
                aria-current={isToday ? "date" : undefined}
                className={`${DAY_BUTTON_BASE} ${!cell.inMonth ? "text-[#C8BEAD]" : "text-[#17171A]"} ${
                  isBoundary
                    ? "bg-[#D8F238] font-semibold text-[#17171A]"
                    : isDisabled
                      ? "cursor-not-allowed text-[#C8BEAD]"
                      : "hover:bg-[#D9D3C9]"
                } ${isToday && !isBoundary ? "ring-1 ring-inset ring-[#17171A]/40" : ""}`}
              >
                {Number(cell.date.slice(8, 10))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PeriodRangeSelector({ value, presets, onApply, today, minDate, maxDate, disabled }: PeriodRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRangeDraft>({ start: value.start, end: value.end });
  const [leftMonth, setLeftMonth] = useState<CalendarMonth>(() => calendarMonthFromDateString(value.start));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activePreset = matchPreset(value, presets);
  const todayYear = Number(today.slice(0, 4));
  const closedLabel = formatCompactPeriodLabel({ start: value.start, end: value.end, presetLabel: activePreset?.label ?? null, todayYear });
  const draftPreset = draft.start && draft.end ? matchPreset({ start: draft.start, end: draft.end }, presets) : null;
  const canApply = Boolean(draft.start && draft.end && isValidDateRange(draft.start, draft.end));

  function openPanel() {
    setDraft({ start: value.start, end: value.end });
    setLeftMonth(calendarMonthFromDateString(value.start));
    setOpen(true);
  }

  function closePanel(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) closePanel(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel(true);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    // Move o foco pro primeiro preset ao abrir — leitor de tela entra
    // direto no conteúdo do popover, sem precisar tabular até lá.
    const firstFocusable = panelRef.current?.querySelector<HTMLButtonElement>("button");
    firstFocusable?.focus();

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleDayClick(date: string) {
    if (minDate !== undefined && date < minDate) return;
    if (maxDate !== undefined && date > maxDate) return;
    setDraft((current) => resolveRangeClick(current, date));
  }

  function handleKeyNavigate(date: string, key: string) {
    const deltaByKey: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const delta = deltaByKey[key];
    if (delta === undefined) return;
    const next = addDaysToDateString(date, delta);
    const target = panelRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${next}"]`);
    target?.focus();
  }

  function handlePresetClick(preset: PeriodRangePreset) {
    setDraft({ start: preset.range.start, end: preset.range.end });
    setLeftMonth(calendarMonthFromDateString(preset.range.start));
  }

  function handleApplyClick() {
    if (!draft.start || !draft.end || !canApply) return;
    const matched = matchPreset({ start: draft.start, end: draft.end }, presets);
    onApply({ start: draft.start, end: draft.end, presetKey: matched?.key ?? null });
    setOpen(false);
  }

  const rightMonth = shiftCalendarMonth(leftMonth, 1);

  return (
    <div ref={containerRef} className="relative inline-block w-full text-left sm:w-auto">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closePanel(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mitza-pressable flex min-h-11 w-full items-center justify-between gap-1.5 rounded-md border border-[#C8BEAD] bg-white px-3 py-1.5 text-sm font-medium text-[#17171A] hover:bg-[#EFE9E0] disabled:pointer-events-none disabled:opacity-50 sm:inline-flex sm:w-auto sm:min-h-0 sm:justify-start"
      >
        {closedLabel}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6F6B65]" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Etapa "Otimização Mobile": backdrop só existe abaixo de `sm` —
              o painel vira bottom sheet (a auditoria confirmou o dropdown
              antigo renderizando 86-94px pra FORA da borda esquerda da
              viewport em 320px, com `right-0` ancorado num trigger que não
              estava perto o suficiente da borda direita). Em `sm+` o
              dropdown de sempre continua idêntico, sem backdrop.
              `sm:left-0` (não `right-0`): o cabeçalho do relatório
              (`report-header.tsx`) posiciona o trigger encostado à
              ESQUERDA do container (nunca empurrado pra direita) — ancorar
              pela direita fazia o painel (até ~500-700px de conteúdo)
              nascer parcialmente fora da tela à esquerda em telas de
              desktop mais estreitas (achado testando esta correção, nunca
              reportado pelo usuário — confirmado e corrigido aqui junto). */}
          <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => closePanel(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Selecionar período"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-[#C8BEAD] bg-white shadow-lg sm:absolute sm:inset-x-auto sm:inset-y-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-auto sm:max-w-[calc(100vw_-_2rem)] sm:overflow-auto sm:rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-[#EFE9E0] px-4 py-3 sm:hidden">
              <span className="text-sm font-semibold text-[#17171A]">Selecionar período</span>
              <button
                type="button"
                onClick={() => closePanel(true)}
                aria-label="Fechar"
                className="flex h-11 w-11 items-center justify-center rounded-full text-[#17171A] hover:bg-[#EFE9E0]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Etapa "Otimização Mobile" (ajuste pós-produção): usuário viu
                em produção e pediu o MESMO layout do desktop no mobile —
                presets à esquerda, calendário à direita, lado a lado, só
                reduzido — em vez do empilhado (presets em cima, calendário
                embaixo) que a Fase 1 desta otimização tinha usado. Abaixo
                de 360px (`max-[359px]:`) essa largura não fecha (calendário
                sozinho já precisa de ~224px pra 7 dias de 32px cada) —
                nesses aparelhos bem estreitos mantém o empilhado antigo,
                que continua seguro em qualquer largura. */}
            <div className="flex flex-1 flex-row overflow-y-auto max-[359px]:flex-col">
              <div className="flex w-28 shrink-0 flex-col gap-0.5 border-r border-[#EFE9E0] p-2 sm:w-40 sm:gap-1 sm:p-3 max-[359px]:w-full max-[359px]:border-b max-[359px]:border-r-0 max-[359px]:p-3">
                {presets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className={`flex min-h-9 w-full shrink-0 items-center rounded-md px-2 text-left text-xs font-medium sm:w-auto sm:min-h-0 sm:rounded-md sm:px-2.5 sm:py-1.5 sm:text-sm max-[359px]:min-h-11 max-[359px]:rounded-lg max-[359px]:px-3 max-[359px]:text-sm ${
                      draftPreset?.key === preset.key ? "bg-[#D8F238] text-[#17171A]" : "text-[#17171A] hover:bg-[#EFE9E0]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-1 flex-col gap-3 p-2 sm:p-2.5">
                <div className="flex flex-row items-start gap-3 max-[359px]:flex-col max-[359px]:items-center">
                  <CalendarMonthGrid
                    month={leftMonth}
                    draft={draft}
                    today={today}
                    minDate={minDate}
                    maxDate={maxDate}
                    onSelect={handleDayClick}
                    onKeyNavigate={handleKeyNavigate}
                    onPrev={() => setLeftMonth((current) => shiftCalendarMonth(current, -1))}
                    onNext={() => setLeftMonth((current) => shiftCalendarMonth(current, 1))}
                  />
                  <CalendarMonthGrid
                    month={rightMonth}
                    draft={draft}
                    today={today}
                    minDate={minDate}
                    maxDate={maxDate}
                    onSelect={handleDayClick}
                    onKeyNavigate={handleKeyNavigate}
                    className="hidden sm:flex"
                  />
                </div>
              </div>
            </div>

            {/* Etapa "Otimização Mobile": rodapé sempre visível (nunca rola
                junto com presets/calendário) — "Aplicar" precisa continuar
                alcançável com uma mão mesmo com o teclado do sistema aberto
                ou pouca altura disponível (item 11 do pedido). */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EFE9E0] px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-2.5 sm:pb-3">
              <button
                type="button"
                onClick={() => closePanel(false)}
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[#17171A] hover:bg-[#EFE9E0] sm:min-h-0 sm:py-1.5"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyClick}
                disabled={!canApply}
                className="flex min-h-11 items-center rounded-md bg-[#D8F238] px-3.5 text-sm font-semibold text-[#17171A] hover:brightness-95 disabled:pointer-events-none disabled:opacity-50 sm:min-h-0 sm:py-1.5"
              >
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
