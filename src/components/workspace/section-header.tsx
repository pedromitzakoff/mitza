import type { ReactNode } from "react";

/** Título pequeno de seção dentro do workspace — uppercase discreto (só o
 * bastante pra marcar hierarquia, sem gritar), com um slot opcional de
 * ação à direita (ex.: "Ver todas", "Ordenar por").
 *
 * Etapa "Refinamento visual da Visão Geral — Síntese": `accent` acrescenta
 * um rail vertical fino em areia (`--sand`) à esquerda do título — mesmo
 * princípio visual do active rail da Sidebar (`ACTIVE_INDICATOR_RAIL_CLASSES`,
 * `components/ui/active-indicator.ts`: barra de 3px, cor de assinatura da
 * marca, nunca decoração grande), formalizado aqui como o padrão
 * compartilhável de "section rail" pra qualquer tela do workspace usar sem
 * duplicar a marcação — não importa nada da Sidebar (que usa tokens
 * `--sidebar-*` fixos, próprios de uma superfície independente de tema);
 * aqui é só `border-sand`, o mesmo token `--sand` já usado em qualquer
 * outro lugar claro do produto. Opt-in (`false` por padrão) — nenhum
 * `SectionHeader` existente muda de aparência sem pedir. */
export function SectionHeader({ title, action, accent = false }: { title: string; action?: ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2
        className={`text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted ${
          accent ? "border-l-[3px] border-sand pl-2" : ""
        }`}
      >
        {title}
      </h2>
      {action}
    </div>
  );
}
