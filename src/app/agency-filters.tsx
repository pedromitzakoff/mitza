"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { ClientCombobox, type ClientComboboxOption } from "./client-combobox";
import { Toolbar } from "@/components/workspace/toolbar";
import { Select } from "@/components/workspace/select";
import { Button } from "@/components/workspace/button";

export type AgencyClientOption = ClientComboboxOption;

/**
 * Toolbar de filtros da Visão Geral — sempre visíveis: carteira (gestor),
 * cliente específico (combobox pesquisável, `client-combobox.tsx`, ainda não
 * migrado pro novo Design System — ver nota de dívida técnica no README) e o
 * botão "Filtros" (diagnóstico/atividade/ritmo/tarefas, escondidos num
 * popover até o usuário pedir). Nada de botão "Filtrar": toda mudança navega
 * na hora.
 *
 * Etapa "Visão Geral + Reports no Core": o filtro "Status da conta"
 * (Saudável/Atenção/Crítico, Sistema B) virou "Diagnóstico" — as mesmas 4
 * categorias do Motor de Diagnóstico Único que a Operação já usa
 * (Planejamento/Investimento/CPA/Pendências). "Atividade" (ativo/atenção/
 * inativo) não muda: é um eixo independente, de dias úteis sem atividade
 * (`operational-activity.ts`), nunca fez parte do modelo de saúde legado.
 *
 * "Carteira" (gestor) e "Cliente" são dois filtros independentes — carteira
 * decide de quem são os clientes mostrados, cliente escolhe um específico
 * dentro do que já está visível.
 */
export function AgencyFilters({
  defaultManager,
  gestores,
  manager,
  clients,
  selectedClientId,
  diagnostico,
  activity,
  ritmo,
  tasks,
  platform,
  preserved,
}: {
  defaultManager: "all" | "me";
  gestores: { id: string; name: string }[];
  manager: string;
  clients: AgencyClientOption[];
  selectedClientId: string | undefined;
  diagnostico: string;
  activity: string;
  ritmo: string;
  tasks: string;
  /** Filtro de plataforma (Etapa 3 — MVP plataformas): "consolidado" é o
   * padrão. Ritmo financeiro só existe pra "consolidado" (não há orçamento
   * configurado por canal), então o select de ritmo some quando a
   * plataforma não é "consolidado" — nunca um filtro que não tem efeito
   * nenhum. */
  platform: "consolidado" | "meta" | "google";
  preserved: { month?: string; sprintBucket?: string; sync?: string; meta?: string; sort?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (diagnostico !== "todos") next.set("diagnostico", diagnostico);
    if (activity !== "todos") next.set("activity", activity);
    if (ritmo !== "todos") next.set("ritmo", ritmo);
    if (tasks !== "todas") next.set("tasks", tasks);
    if (platform !== "consolidado") next.set("platform", platform);
    if (preserved.sprintBucket) next.set("sprintBucket", preserved.sprintBucket);
    if (preserved.sync) next.set("sync", preserved.sync);
    if (preserved.meta) next.set("meta", preserved.meta);
    if (preserved.sort) next.set("sort", preserved.sort);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  }

  // Trocar de plataforma nunca deve manter um filtro de ritmo que passou a
  // não fazer sentido — ao sair de "consolidado" o ritmo é sempre limpo.
  function handlePlatformChange(value: string) {
    router.push(buildUrl({ platform: value === "consolidado" ? "" : value, ritmo: value === "consolidado" ? ritmo : "" }));
  }

  const secondaryCount = [diagnostico !== "todos", activity !== "todos", ritmo !== "todos", tasks !== "todas"].filter(
    Boolean,
  ).length;

  const hasAnythingToClear =
    secondaryCount > 0 ||
    Boolean(selectedClientId) ||
    Boolean(preserved.sprintBucket) ||
    Boolean(preserved.sync) ||
    Boolean(preserved.meta) ||
    platform !== "consolidado";

  function clearFilters() {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", defaultManager);
    router.push(`/?${next.toString()}`);
    setOpen(false);
  }

  return (
    <Toolbar>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-overview-text-muted">Carteira</span>
        <Select value={manager} onChange={(e) => router.push(buildUrl({ manager: e.target.value }))} aria-label="Carteira">
          <option value="me">Meus clientes</option>
          <option value="all">Todos os clientes</option>
          {gestores.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-overview-text-muted">Plataforma</span>
        <Select value={platform} onChange={(e) => handlePlatformChange(e.target.value)} aria-label="Plataforma">
          <option value="consolidado">Consolidado</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
        </Select>
      </div>

      <ClientCombobox
        clients={clients}
        selectedClientId={selectedClientId}
        onSelect={(clientId) => router.push(buildUrl({ client: clientId }))}
      />

      <div className="relative">
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Filtros
          {secondaryCount > 0 && (
            <span className="rounded-full bg-overview-brand-subtle px-1.5 text-[11px] font-semibold text-brand">
              {secondaryCount}
            </span>
          )}
        </Button>

        {open && (
          <>
            <button
              type="button"
              aria-label="Fechar filtros"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
            />
            <div className="mitza-menu-in absolute right-0 z-50 mt-2 w-72 rounded-lg border border-overview-border bg-overview-surface p-3 shadow-[var(--shadow-float)]">
              <div className="flex flex-col gap-2">
                <Select value={diagnostico} onChange={(e) => router.push(buildUrl({ diagnostico: e.target.value }))} className="w-full">
                  <option value="todos">Diagnóstico: todos</option>
                  <option value="planejamento">Planejamento</option>
                  <option value="investimento">Investimento</option>
                  <option value="cpa">CPA</option>
                  <option value="pendencias">Pendências</option>
                </Select>

                <Select value={activity} onChange={(e) => router.push(buildUrl({ activity: e.target.value }))} className="w-full">
                  <option value="todos">Atividade: todas</option>
                  <option value="ativo">Ativos</option>
                  <option value="atencao">Atenção por inatividade</option>
                  <option value="inativo">Inativos</option>
                </Select>

                {/* Ritmo financeiro só existe pro orçamento CONSOLIDADO
                    (Etapa 3 — não há orçamento configurado por canal) —
                    escondido fora desse recorte pra nunca oferecer um
                    filtro sem efeito nenhum. */}
                {platform === "consolidado" ? (
                  <Select value={ritmo} onChange={(e) => router.push(buildUrl({ ritmo: e.target.value }))} className="w-full">
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

                <Select value={tasks} onChange={(e) => router.push(buildUrl({ tasks: e.target.value }))} className="w-full">
                  <option value="todas">Tarefas: todas</option>
                  <option value="atrasadas">Com tarefas atrasadas</option>
                  <option value="sem_atrasadas">Sem tarefas atrasadas</option>
                </Select>
              </div>
            </div>
          </>
        )}
      </div>

      {hasAnythingToClear && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-brand hover:text-brand hover:bg-overview-brand-subtle">
          Limpar filtros
        </Button>
      )}
    </Toolbar>
  );
}
