"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";
import { ScopeSelector, type ScopeValue } from "./scope-selector";
import type { ClientComboboxOption } from "./client-combobox";
import { PLATFORM_LABEL } from "./client-objective-table";
import { PERFORMANCE_GOAL_OPTIONS } from "@/lib/performance-goals";
import { useFloatingMenuPosition, FloatingPortalPanel } from "@/lib/floating-menu";
import { Select } from "@/components/workspace/select";
import { Button } from "@/components/workspace/button";
import { SandRail } from "@/components/workspace/sand-rail";

export type AgencyClientOption = ClientComboboxOption;

const DIAGNOSTIC_LABEL: Record<string, string> = {
  planejamento: "Planejamento",
  investimento: "Investimento",
  cpa: "CPA",
  pendencias: "Pendências",
};

const RESULT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PERFORMANCE_GOAL_OPTIONS.map((option) => [option.value, option.label]),
);

const RITMO_LABEL: Record<string, string> = {
  abaixo: "Abaixo do ritmo",
  dentro: "No ritmo",
  acima: "Acima do ritmo",
  sem_meta: "Meta não configurada",
};

/**
 * Barra de contexto da Visão Geral — reescrita (pedido explícito do
 * usuário: "parece um formulário de cadastro, não um controle de
 * dashboard"). Lado esquerdo: escopo (substitui os antigos "Carteira" +
 * "Cliente" — nunca coexistem na UI nova, ver `ScopeSelector`) + plataforma.
 * Lado direito: navegação de mês (`monthNav`, recebida pronta de `page.tsx`)
 * + "Filtros" (popover com os 3 critérios que sobram depois do escopo
 * cobrir Gestor/Cliente: Situação da conta/Tipo de resultado/Ritmo de
 * investimento) + "Limpar filtros" (só quando há algo ativo). Chips
 * removíveis abaixo da barra espelham cada filtro ativo, incluindo o
 * próprio escopo quando é um gestor ou cliente específico.
 */
export function AgencyFilters({
  defaultManager,
  gestores,
  manager,
  clients,
  selectedClientId,
  diagnostico,
  resultType,
  ritmo,
  platform,
  preserved,
  monthNav,
}: {
  defaultManager: "all" | "me";
  gestores: { id: string; name: string }[];
  manager: string;
  clients: AgencyClientOption[];
  selectedClientId: string | undefined;
  diagnostico: string;
  resultType: string;
  ritmo: string;
  /** Filtro de plataforma (Etapa 3 — MVP plataformas): "consolidado" é o
   * padrão. Ritmo financeiro só existe pra "consolidado" (não há orçamento
   * configurado por canal), então o select de ritmo some quando a
   * plataforma não é "consolidado" — nunca um filtro que não tem efeito
   * nenhum. */
  platform: "consolidado" | "meta" | "google" | "tiktok";
  preserved: { month?: string; sprintBucket?: string; sync?: string; meta?: string };
  /** Navegação de mês (‹ Agosto de 2026 ›) — construída em `page.tsx` (usa
   * `IconButton`/`Button` de Server Component) e recebida pronta aqui pra
   * viver na mesma linha de "Filtros", à direita — ver Etapa "Cabeçalho
   * executivo": o antigo `PageHeader` (título "Visão Geral" + esta nav como
   * `actions`) saiu, e a nav passou a fazer parte da toolbar. */
  monthNav: ReactNode;
}) {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const filtersPosition = useFloatingMenuPosition(filtersTriggerRef, filtersOpen, "right");

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (diagnostico !== "todos") next.set("diagnostico", diagnostico);
    if (resultType !== "todos") next.set("resultType", resultType);
    if (ritmo !== "todos") next.set("ritmo", ritmo);
    if (platform !== "consolidado") next.set("platform", platform);
    if (preserved.sprintBucket) next.set("sprintBucket", preserved.sprintBucket);
    if (preserved.sync) next.set("sync", preserved.sync);
    if (preserved.meta) next.set("meta", preserved.meta);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  }

  // Escopo: um único controle por trás do qual vivem `manager`+`client` —
  // selecionar um cliente específico sempre reseta a carteira pra "all"
  // (nunca deixa um cliente escolhido "sumir" por causa de um gestor que
  // não é o dele); selecionar um gestor (ou "Todos"/"Minhas contas") sempre
  // limpa o cliente.
  const scopeValue: ScopeValue = selectedClientId
    ? { kind: "client", id: selectedClientId }
    : manager === "all"
      ? { kind: "all" }
      : manager === "me"
        ? { kind: "me" }
        : { kind: "manager", id: manager };

  function handleScopeSelect(next: ScopeValue) {
    if (next.kind === "client") {
      router.push(buildUrl({ manager: "all", client: next.id }));
    } else if (next.kind === "manager") {
      router.push(buildUrl({ manager: next.id, client: "" }));
    } else {
      router.push(buildUrl({ manager: next.kind, client: "" }));
    }
  }

  // Trocar de plataforma nunca deve manter um filtro de ritmo que passou a
  // não fazer sentido — ao sair de "consolidado" o ritmo é sempre limpo.
  function handlePlatformChange(value: string) {
    router.push(buildUrl({ platform: value === "consolidado" ? "" : value, ritmo: value === "consolidado" ? ritmo : "" }));
  }

  const secondaryCount = [diagnostico !== "todos", resultType !== "todos", ritmo !== "todos"].filter(Boolean).length;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (scopeValue.kind === "manager") {
    const name = gestores.find((g) => g.id === scopeValue.id)?.name ?? "Gestor";
    chips.push({ key: "manager", label: `Gestor: ${name}`, onRemove: () => router.push(buildUrl({ manager: "all", client: "" })) });
  }
  if (scopeValue.kind === "client") {
    const name = clients.find((c) => c.id === scopeValue.id)?.name ?? "Cliente";
    chips.push({ key: "client", label: `Cliente: ${name}`, onRemove: () => router.push(buildUrl({ manager: "all", client: "" })) });
  }
  if (platform !== "consolidado") {
    chips.push({ key: "platform", label: PLATFORM_LABEL[platform], onRemove: () => router.push(buildUrl({ platform: "", ritmo: "" })) });
  }
  if (diagnostico !== "todos") {
    chips.push({
      key: "diagnostico",
      label: DIAGNOSTIC_LABEL[diagnostico] ?? diagnostico,
      onRemove: () => router.push(buildUrl({ diagnostico: "" })),
    });
  }
  if (resultType !== "todos") {
    chips.push({
      key: "resultType",
      label: RESULT_TYPE_LABEL[resultType] ?? resultType,
      onRemove: () => router.push(buildUrl({ resultType: "" })),
    });
  }
  if (ritmo !== "todos" && platform === "consolidado") {
    chips.push({ key: "ritmo", label: RITMO_LABEL[ritmo] ?? ritmo, onRemove: () => router.push(buildUrl({ ritmo: "" })) });
  }

  const hasAnythingToClear =
    chips.length > 0 || Boolean(preserved.sprintBucket) || Boolean(preserved.sync) || Boolean(preserved.meta);

  function clearFilters() {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", defaultManager);
    router.push(`/?${next.toString()}`);
    setFiltersOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Etapa "Micro-refinamento da barra de filtros": o container
          (`Toolbar`, borda+fundo envolvendo a linha inteira) saiu — os
          controles ficam direto sobre o fundo da página, tão abertos quanto
          o resto da Visão Geral. Cada controle mantém sua própria borda/
          superfície individual (nada mudou em comportamento/opções/estado),
          só ganhou o rail em areia (`SandRail`) à esquerda — a mesma
          assinatura do item ativo da Sidebar e do título "Desempenho da
          agência" (`SectionHeader accent`), reaproveitada aqui numa técnica
          diferente (curta e centralizada, não `border-l` de altura
          inteira) porque estes controles são mais altos que o texto dentro
          deles. "Filtros" fica de fora de propósito (item 6 do pedido): é
          uma ação, não um seletor de contexto/escopo. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <ScopeSelector value={scopeValue} gestores={gestores} clients={clients} onSelect={handleScopeSelect} />
          <div className="relative">
            <SandRail />
            <Select
              value={platform}
              onChange={(e) => handlePlatformChange(e.target.value)}
              aria-label="Plataforma"
              style={{ paddingLeft: "1rem" }}
            >
              <option value="consolidado">Consolidado</option>
              <option value="meta">Meta Ads</option>
              <option value="google">Google Ads</option>
              <option value="tiktok">TikTok Ads</option>
            </Select>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {monthNav}

          <span ref={filtersTriggerRef} className="relative inline-block">
            <SandRail />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFiltersOpen((v) => !v)}
              style={{ paddingLeft: "1rem" }}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filtros
              {secondaryCount > 0 && (
                <span className="rounded-full bg-overview-brand-subtle px-1.5 text-[11px] font-semibold text-brand">
                  {secondaryCount}
                </span>
              )}
            </Button>
          </span>

          {hasAnythingToClear && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-brand hover:bg-overview-brand-subtle hover:text-brand">
              Limpar filtros
            </Button>
          )}
        </div>

        <FloatingPortalPanel
          open={filtersOpen}
          position={filtersPosition}
          onClose={() => setFiltersOpen(false)}
          role="menu"
          closeLabel="Fechar filtros"
          className="w-72 -translate-x-full rounded-lg border border-overview-border bg-overview-surface p-3 shadow-[var(--shadow-float)]"
        >
          <div className="flex flex-col gap-2">
            <Select
              value={diagnostico}
              onChange={(e) => router.push(buildUrl({ diagnostico: e.target.value }))}
              className="w-full"
              aria-label="Situação da conta"
            >
              <option value="todos">Situação da conta: todas</option>
              <option value="planejamento">Planejamento</option>
              <option value="investimento">Investimento</option>
              <option value="cpa">CPA</option>
              <option value="pendencias">Pendências</option>
            </Select>

            <Select
              value={resultType}
              onChange={(e) => router.push(buildUrl({ resultType: e.target.value }))}
              className="w-full"
              aria-label="Tipo de resultado"
            >
              <option value="todos">Tipo de resultado: todos</option>
              {PERFORMANCE_GOAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            {/* Ritmo financeiro só existe pro orçamento CONSOLIDADO (Etapa 3
                — não há orçamento configurado por canal) — escondido fora
                desse recorte pra nunca oferecer um filtro sem efeito
                nenhum. */}
            {platform === "consolidado" ? (
              <Select
                value={ritmo}
                onChange={(e) => router.push(buildUrl({ ritmo: e.target.value }))}
                className="w-full"
                aria-label="Ritmo de investimento"
              >
                <option value="todos">Ritmo de investimento: todos</option>
                <option value="abaixo">Abaixo</option>
                <option value="dentro">No ritmo</option>
                <option value="acima">Acima</option>
                <option value="sem_meta">Meta não configurada</option>
              </Select>
            ) : (
              <p className="text-[11px] text-overview-text-muted">
                Ritmo de investimento disponível só no recorte Consolidado.
              </p>
            )}
          </div>
        </FloatingPortalPanel>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="mitza-pressable inline-flex items-center gap-1 rounded-full border border-overview-border bg-overview-surface px-2 py-0.5 text-[11px] font-medium text-overview-text-primary transition-colors hover:border-overview-border-strong hover:bg-overview-surface-hover"
            >
              {chip.label}
              <X className="h-3 w-3 text-overview-text-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
