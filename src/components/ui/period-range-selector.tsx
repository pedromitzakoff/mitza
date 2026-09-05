"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
    <div className={`flex w-full flex-col gap-2 sm:w-56 ${className ?? ""}`}>
      <div className="flex items-center justify-between px-1">
        {onPrev ? (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Mês anterior"
            className="rounded-md p-1 text-[#17171A] hover:bg-[#EFE9E0]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-6 w-6" aria-hidden="true" />
        )}
        <span className="text-sm font-semibold capitalize text-[#17171A]">{monthLabel}</span>
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Próximo mês"
            className="rounded-md p-1 text-[#17171A] hover:bg-[#EFE9E0]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-6 w-6" aria-hidden="true" />
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
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closePanel(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mitza-pressable inline-flex items-center gap-1.5 rounded-md border border-[#C8BEAD] bg-white px-3 py-1.5 text-sm font-medium text-[#17171A] hover:bg-[#EFE9E0] disabled:pointer-events-none disabled:opacity-50"
      >
        {closedLabel}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6F6B65]" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Selecionar período"
          className="absolute right-0 z-50 mt-2 max-w-[calc(100vw_-_2rem)] overflow-auto rounded-xl border border-[#C8BEAD] bg-white shadow-lg"
        >
          <div className="flex flex-col sm:flex-row">
            <div className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-[#EFE9E0] p-2 sm:w-40 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm font-medium ${
                    draftPreset?.key === preset.key ? "bg-[#D8F238] text-[#17171A]" : "text-[#17171A] hover:bg-[#EFE9E0]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex flex-1 flex-col gap-3 p-2.5">
              <div className="flex flex-col gap-3 sm:flex-row">
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

              <div className="flex items-center justify-end gap-2 border-t border-[#EFE9E0] pt-3">
                <button type="button" onClick={() => closePanel(false)} className="rounded-md px-3 py-1.5 text-sm font-medium text-[#17171A] hover:bg-[#EFE9E0]">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleApplyClick}
                  disabled={!canApply}
                  className="rounded-md bg-[#D8F238] px-3.5 py-1.5 text-sm font-semibold text-[#17171A] hover:brightness-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
