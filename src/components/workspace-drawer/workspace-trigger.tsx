"use client";

import { NotebookPen } from "lucide-react";
import { useWorkspace } from "./workspace-provider";

/**
 * Botão discreto e permanente pedido pela Etapa "MITZA 2.0 — Workspace
 * Pessoal" — de propósito NÃO é um item de navegação (não está na
 * Sidebar, não é uma rota): fica flutuando por cima de qualquer tela,
 * único jeito de abrir o painel. Some visualmente atrás do próprio
 * drawer quando ele está aberto (mesmo canto, z-index menor).
 */
export function WorkspaceTrigger() {
  const { open } = useWorkspace();

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Abrir Workspace pessoal"
      title="Workspace pessoal"
      className="mitza-pressable fixed bottom-5 right-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900"
    >
      <NotebookPen className="h-5 w-5" />
    </button>
  );
}
