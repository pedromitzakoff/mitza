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
 * Toolbar de filtros da Visão Geral (visual reformulado na Etapa 47 — só
 * classes/componentes novos, nenhuma mudança de lógica/params) — sempre
 * visíveis: carteira (gestor), cliente específico (combobox pesquisável,
 * `client-combobox.tsx`, ainda não migrado pro novo Design System — ver
 * nota de dívida técnica no README) e o botão "Filtros" (status da conta/
 * atividade/ritmo/tarefas, escondidos num popover até o usuário pedir).
 * Nada de botão "Filtrar": toda mudança navega na hora.
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
  health,
  activity,
  ritmo,
  tasks,
  preserved,
}: {
  defaultManager: "all" | "me";
  gestores: { id: string; name: string }[];
  manager: string;
  clients: AgencyClientOption[];
  selectedClientId: string | undefined;
  health: string;
  activity: string;
  ritmo: string;
  tasks: string;
  preserved: { month?: string; sprintBucket?: string; sync?: string; meta?: string; sort?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (health !== "todos") next.set("health", health);
    if (activity !== "todos") next.set("activity", activity);
    if (ritmo !== "todos") next.set("ritmo", ritmo);
    if (tasks !== "todas") next.set("tasks", tasks);
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

  const secondaryCount = [health !== "todos", activity !== "todos", ritmo !== "todos", tasks !== "todas"].filter(
    Boolean,
  ).length;

  const hasAnythingToClear =
    secondaryCount > 0 ||
    Boolean(selectedClientId) ||
    Boolean(preserved.sprintBucket) ||
    Boolean(preserved.sync) ||
    Boolean(preserved.meta);

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
            <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-overview-border bg-overview-surface p-3 shadow-[var(--shadow-float)]">
              <div className="flex flex-col gap-2">
                <Select value={health} onChange={(e) => router.push(buildUrl({ health: e.target.value }))} className="w-full">
                  <option value="todos">Status da conta: todos</option>
                  <option value="saudavel">Saudável</option>
                  <option value="atencao">Atenção</option>
                  <option value="critico">Crítico</option>
                </Select>

                <Select value={activity} onChange={(e) => router.push(buildUrl({ activity: e.target.value }))} className="w-full">
                  <option value="todos">Atividade: todas</option>
                  <option value="ativo">Ativos</option>
                  <option value="atencao">Atenção por inatividade</option>
                  <option value="inativo">Inativos</option>
                </Select>

                <Select value={ritmo} onChange={(e) => router.push(buildUrl({ ritmo: e.target.value }))} className="w-full">
                  <option value="todos">Ritmo de investimento: todos</option>
                  <option value="abaixo">Abaixo</option>
                  <option value="dentro">No ritmo</option>
                  <option value="acima">Acima</option>
                  <option value="sem_meta">Meta não configurada</option>
                </Select>

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
