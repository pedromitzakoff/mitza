"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/workspace/badge";
import type { StatusTone as WorkspaceStatusTone } from "@/components/workspace/status-dot";
import type { StatusTone } from "@/lib/status-registry";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import {
  OPERATION_TRIAGE_BAND_ORDER,
  shiftOperationMonth,
  type OperationTriageBand,
  type OperationTriageClient,
} from "@/lib/operation-triage";
import { OPERATION_TRIAGE_BAND_REGISTRY } from "@/lib/status-registry";

type BandFilter = "todos" | OperationTriageBand;

/** `Badge` (design system, hoje só adotado na Visão Geral) usa um
 * `StatusTone` mais estreito que o do registry central — sem "info". As 4
 * bandas de Operação nunca usam "info"/"brand" (ver `status-registry.ts`),
 * mas o mapeamento precisa ser exaustivo pro TypeScript aceitar. */
function toWorkspaceTone(tone: StatusTone): WorkspaceStatusTone {
  if (tone === "info") return "neutral";
  return tone;
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

const AVATAR_PALETTE = [
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
];

function avatarClass(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatReviewLabel(daysAgo: number | null): string {
  if (daysAgo === null) return "Nunca revisada";
  if (daysAgo === 0) return "Hoje";
  if (daysAgo === 1) return "1 dia";
  return `${daysAgo} dias`;
}

function formatSpendDelta(fraction: number | null): { text: string; muted: boolean } | null {
  if (fraction === null) return null;
  const pct = Math.round(Math.abs(fraction) * 100);
  const direction = fraction >= 0 ? "+" : "-";
  return { text: `${direction}${pct}% vs. mês anterior`, muted: Math.abs(fraction) <= 0.2 };
}

function BandTile({
  band,
  count,
  active,
  onClick,
}: {
  band: BandFilter;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const label = band === "todos" ? "Todos" : OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${band}`].label;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mitza-pressable flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active ? "border-brand bg-brand/5" : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
    >
      <span className="text-xl font-semibold tabular-nums text-foreground">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  );
}

function ClientRow({ client }: { client: OperationTriageClient }) {
  const badge = OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${client.band}`];
  const [primaryReason, ...restReasons] = client.reasons;
  const delta = formatSpendDelta(client.monthSpendDeltaFraction);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(client.clientId)}`}
        aria-hidden="true"
      >
        {initialOf(client.clientName)}
      </span>

      <div className="w-40 shrink-0">
        <p className="truncate text-sm font-medium text-foreground">{client.clientName}</p>
        <p className="truncate text-xs text-muted-foreground">{client.managerName ?? "Sem responsável"}</p>
      </div>

      <div className="w-28 shrink-0">
        <Badge tone={toWorkspaceTone(badge.tone)}>{badge.label}</Badge>
      </div>

      {/* Motivo — protagonista da linha (seção 4 do pedido): mais espaço
       * que qualquer outra coluna, texto real em vez de número. */}
      <div className="min-w-0 flex-1">
        {primaryReason ? (
          <p className="truncate text-sm font-medium text-foreground">{primaryReason}</p>
        ) : (
          <p className="truncate text-sm text-muted-foreground">Nenhum sinal de atenção no momento</p>
        )}
        {restReasons.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {restReasons[0]}
            {restReasons.length > 1 ? ` +${restReasons.length - 1}` : ""}
          </p>
        )}
      </div>

      <div className="w-32 shrink-0 text-right">
        <p className="text-sm tabular-nums text-foreground">{formatCurrency(client.monthSpend)}</p>
        {delta && (
          <p className={`text-xs tabular-nums ${delta.muted ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
            {delta.text}
          </p>
        )}
      </div>

      <div className="w-24 shrink-0 text-right text-xs text-muted-foreground">
        {formatReviewLabel(client.reviewDaysAgo)}
      </div>

      <Link
        href={`/clients/${client.clientId}`}
        className="mitza-pressable shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Abrir cliente
      </Link>
    </li>
  );
}

/**
 * Tela nova, do zero — não é a Sprint adaptada. A Sprint organizava
 * trabalho; isto organiza atenção: a única decisão que esta tela existe
 * pra apoiar é "qual cliente eu abro agora". Por isso não há score
 * numérico nem barra de saúde visíveis (só banda + motivo, linguagem
 * natural) e não há nenhuma ação além de "Abrir cliente" — resolver
 * qualquer coisa acontece dentro do painel do cliente, nunca aqui.
 */
export function OperationTriageView({
  clients,
  monthParam,
  monthLastUpdatedLabel,
  bandCounts,
}: {
  clients: OperationTriageClient[];
  monthParam: string;
  monthLastUpdatedLabel: string;
  bandCounts: Record<OperationTriageBand, number>;
}) {
  const [bandFilter, setBandFilter] = useState<BandFilter>("todos");
  const [query, setQuery] = useState("");

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((client) => {
      if (bandFilter !== "todos" && client.band !== bandFilter) return false;
      if (normalizedQuery && !client.clientName.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [clients, bandFilter, query]);

  const totalCount = clients.length;
  const prevMonthHref = `/operation?month=${shiftOperationMonth(monthParam, -1)}`;
  const nextMonthHref = `/operation?month=${shiftOperationMonth(monthParam, 1)}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operação</h1>
          <p className="text-sm text-muted-foreground">Triagem da operação — veja onde sua atenção é mais necessária.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={prevMonthHref}
            aria-label="Mês anterior"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ‹
          </Link>
          <span className="min-w-32 text-center text-sm font-medium text-foreground">{formatMonthLabel(monthParam)}</span>
          <Link
            href={nextMonthHref}
            aria-label="Próximo mês"
            className="mitza-pressable rounded-md border border-border px-2 py-1 text-sm text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ›
          </Link>
          <span className="ml-2 text-xs text-muted-foreground">{monthLastUpdatedLabel}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <BandTile band="todos" count={totalCount} active={bandFilter === "todos"} onClick={() => setBandFilter("todos")} />
        {OPERATION_TRIAGE_BAND_ORDER.map((band) => (
          <BandTile
            key={band}
            band={band}
            count={bandCounts[band]}
            active={bandFilter === band}
            onClick={() => setBandFilter(band)}
          />
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cliente..."
          className="w-full rounded-md border border-border bg-transparent py-1.5 pl-8 pr-3 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
        />
      </div>

      {filteredClients.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {filteredClients.map((client) => (
            <ClientRow key={client.clientId} client={client} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {totalCount === 0 ? "Nenhum cliente ativo neste mês." : "Nenhum cliente encontrado com esse filtro."}
        </p>
      )}
    </div>
  );
}
