"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";
import { IconButton } from "@/components/workspace/button";
import { formatMonthLabel } from "@/lib/format";
import {
  type PeriodShortcut,
  type DateRange,
  type ResolvedPeriod,
  resolveShortcutRange,
  formatPeriodLabel,
  buildPeriodHref,
  startOfMonth,
  endOfMonth,
  shiftDays,
} from "@/lib/date-range";

/**
 * KOFF Analytics — "Seletor global de período" (pedido explícito do
 * usuário, substitui o antigo seletor de mês): UM componente só, usado
 * pelas 4 experiências (agência/cliente × desktop/mobile) — nunca um
 * seletor por dispositivo/tipo de usuário. A diferença visual
 * desktop/mobile é só CSS responsivo sobre a MESMA árvore/estado (popover
 * ancorado em `lg:`, "bottom sheet" fixo abaixo disso) — nunca dois
 * componentes.
 *
 * Estado de rascunho (`draftShortcut`/`draftRange`) só vira navegação real
 * no "Aplicar" (`router.push`) — "Cancelar"/fechar sem aplicar descarta
 * tudo, porque o próximo "abrir" reinicia o rascunho a partir do período
 * JÁ APLICADO (`resolved`, vindo do servidor), nunca do que ficou
 * pendurado da última tentativa.
 */

const SHORTCUT_LABELS: Record<Exclude<PeriodShortcut, "custom">, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last7: "Últimos 7 dias",
  last30: "Últimos 30 dias",
  thisMonth: "Este mês",
  lastMonth: "Mês passado",
};
const SHORTCUT_ORDER: Exclude<PeriodShortcut, "custom">[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"];
const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

function prevCalendarMonth(monthStart: string): string {
  return startOfMonth(shiftDays(monthStart, -1));
}
function nextCalendarMonth(monthStart: string): string {
  return startOfMonth(shiftDays(endOfMonth(monthStart), 1));
}

/** Grade de 42 células (6 semanas), domingo primeiro — `null` = célula de
 * preenchimento (fora do mês), nunca um dia clicável. */
function buildMonthCells(monthStart: string): (string | null)[] {
  const [year, month] = monthStart.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function CalendarGrid({
  monthStart,
  range,
  today,
  onPickDay,
  onPrevMonth,
  onNextMonth,
}: {
  monthStart: string;
  range: DateRange;
  today: string;
  onPickDay: (day: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const cells = buildMonthCells(monthStart);
  // `formatMonthLabel` (mesma função do cabeçalho do Cockpit) capitaliza só
  // a primeira letra do mês — nunca `capitalize` via CSS, que também
  // maiusculiza a preposição "de" ("Novembro De 2026", errado em
  // português).
  const monthLabel = formatMonthLabel(monthStart);

  return (
    <div className="w-64">
      <div className="flex items-center justify-between">
        <IconButton aria-label="Mês anterior" variant="ghost" size="sm" onClick={onPrevMonth}>
          &lsaquo;
        </IconButton>
        <p className="text-xs font-semibold text-overview-text-primary">{monthLabel}</p>
        <IconButton aria-label="Próximo mês" variant="ghost" size="sm" onClick={onNextMonth}>
          &rsaquo;
        </IconButton>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-0.5 text-center text-[10px] font-medium uppercase text-overview-text-muted">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const inRange = day >= range.firstDay && day <= range.lastDay;
          const isEdge = day === range.firstDay || day === range.lastDay;
          const isFuture = day > today;
          return (
            <button
              key={day}
              type="button"
              disabled={isFuture}
              onClick={() => onPickDay(day)}
              aria-pressed={isEdge}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums ${
                isFuture
                  ? "cursor-not-allowed text-overview-text-muted/40"
                  : isEdge
                    ? "bg-brand text-white"
                    : inRange
                      ? "bg-brand/10 text-overview-text-primary"
                      : "text-overview-text-primary hover:bg-overview-surface-hover"
              }`}
            >
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Painel de seleção propriamente dito — montado DO ZERO a cada abertura
 * (`key` muda no componente pai), nunca via `useEffect` reiniciando estado:
 * o rascunho já nasce correto (inicializadores de `useState`, direto dos
 * props), sem a cascata de re-render que um reset por efeito causaria.
 */
function PeriodRangePickerPanel({
  basePath,
  resolved,
  today,
  onApply,
  onCancel,
}: {
  basePath: string;
  resolved: ResolvedPeriod;
  today: string;
  onApply: (href: string) => void;
  onCancel: () => void;
}) {
  const searchParams = useSearchParams();
  const [draftShortcut, setDraftShortcut] = useState<PeriodShortcut>(resolved.shortcut);
  const [draftRange, setDraftRange] = useState<DateRange>(resolved.range);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<string>(startOfMonth(resolved.range.lastDay));

  function pickShortcut(shortcut: Exclude<PeriodShortcut, "custom">) {
    const range = resolveShortcutRange(shortcut, today);
    setDraftShortcut(shortcut);
    setDraftRange(range);
    setPendingStart(null);
    setCalendarMonth(startOfMonth(range.lastDay));
  }

  function pickDay(day: string) {
    if (!day || day > today) return;
    if (pendingStart === null) {
      setPendingStart(day);
      setDraftRange({ firstDay: day, lastDay: day });
      setDraftShortcut("custom");
      return;
    }
    const firstDay = pendingStart < day ? pendingStart : day;
    const lastDay = pendingStart < day ? day : pendingStart;
    setDraftRange({ firstDay, lastDay });
    setDraftShortcut("custom");
    setPendingStart(null);
  }

  const draftLabel = formatPeriodLabel({ shortcut: draftShortcut, range: draftRange, monthParam: "", isMonthAligned: false });

  return (
    <>
      <button type="button" aria-label="Fechar" onClick={onCancel} className="fixed inset-0 z-40 bg-black/30 lg:bg-transparent" />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-overview-border bg-overview-surface shadow-[var(--shadow-float)] lg:absolute lg:inset-auto lg:bottom-auto lg:left-0 lg:top-full lg:mt-2 lg:max-h-none lg:w-auto lg:rounded-xl">
        <div className="flex flex-col lg:flex-row">
          <div className="flex gap-1.5 overflow-x-auto p-3 pb-2 lg:w-36 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-r lg:border-overview-border lg:pb-3">
            {SHORTCUT_ORDER.map((shortcut) => (
              <button
                key={shortcut}
                type="button"
                onClick={() => pickShortcut(shortcut)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-left text-xs font-medium lg:w-full lg:rounded-md ${
                  draftShortcut === shortcut
                    ? "bg-brand text-white lg:bg-brand/10 lg:text-brand"
                    : "border border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover lg:border-0"
                }`}
              >
                {SHORTCUT_LABELS[shortcut]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDraftShortcut("custom");
                setPendingStart(null);
              }}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-left text-xs font-medium lg:w-full lg:rounded-md ${
                draftShortcut === "custom"
                  ? "bg-brand text-white lg:bg-brand/10 lg:text-brand"
                  : "border border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover lg:border-0"
              }`}
            >
              Personalizado
            </button>
          </div>

          <div className="flex flex-col items-center p-3">
            <CalendarGrid
              monthStart={calendarMonth}
              range={draftRange}
              today={today}
              onPickDay={pickDay}
              onPrevMonth={() => setCalendarMonth((m) => prevCalendarMonth(m))}
              onNextMonth={() => setCalendarMonth((m) => nextCalendarMonth(m))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-overview-border p-3">
          <p className="min-w-0 truncate text-xs text-overview-text-secondary">{draftLabel}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="mitza-pressable rounded-md border border-overview-border px-3 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply(buildPeriodHref(basePath, searchParams.toString(), draftShortcut, draftRange))}
              className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function PeriodRangePicker({ basePath, resolved, today }: { basePath: string; resolved: ResolvedPeriod; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setOpenKey((k) => k + 1);
        }}
        aria-expanded={open}
        className="mitza-pressable inline-flex items-center gap-1.5 rounded-full border border-overview-border bg-overview-surface px-3 py-1.5 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
      >
        <Calendar className="h-3.5 w-3.5 text-overview-text-secondary" aria-hidden="true" />
        {formatPeriodLabel(resolved)}
      </button>

      {open && (
        <PeriodRangePickerPanel
          key={openKey}
          basePath={basePath}
          resolved={resolved}
          today={today}
          onCancel={() => setOpen(false)}
          onApply={(href) => {
            router.push(href);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
