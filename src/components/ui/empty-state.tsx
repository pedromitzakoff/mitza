import type { ReactNode } from "react";

type EmptyStateSize = "2xs" | "xs" | "sm";

const SIZE_CLASSES: Record<EmptyStateSize, string> = {
  "2xs": "text-[11px]",
  xs: "text-xs",
  sm: "text-sm",
};

/**
 * Design System oficial (tokens base) — Onda 1. Estado vazio compacto:
 * cada tela mantém sua própria condição de exibição e seu próprio
 * espaçamento (`className`); o componente só centraliza cor/tamanho de
 * fonte, que antes eram redefinidos à mão em cada arquivo.
 */
export function EmptyState({
  children,
  size = "sm",
  className,
}: {
  children: ReactNode;
  size?: EmptyStateSize;
  className?: string;
}) {
  return <p className={`${SIZE_CLASSES[size]} text-muted-foreground ${className ?? ""}`}>{children}</p>;
}

/**
 * Etapa "Sprint Workspace Polish 1.0" (Parte 4) — estado vazio em formato de
 * LINHA, para colunas que normalmente são listas em `<ul>` com borda/raio
 * (Tarefas, Otimizações): antes, uma área vazia virava só um `<p>` sem
 * moldura, encolhendo e deixando as duas colunas com pesos visuais bem
 * diferentes quando uma tinha itens e a outra não. Esta variante mantém a
 * mesma moldura (borda + raio) e uma altura mínima próxima da de uma linha
 * real da lista — nunca 3-4 placeholders vazios, sempre uma linha só.
 */
export function EmptyStateRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex min-h-[38px] items-center rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
