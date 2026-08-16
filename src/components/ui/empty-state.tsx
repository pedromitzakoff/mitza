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
 *
 * Etapa "Unificação visual da página do cliente": cor migrada pro token
 * `overview-*` (mesma família de Operação/Dashboard/Configurações) — como
 * este componente é reaproveitado por várias telas, a correção de token
 * aqui já resolve todo mundo que o usa, sem precisar tocar em cada
 * chamador. Mesma API (`children`/`size`/`className`), nenhum comportamento
 * mudou.
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
  return <p className={`${SIZE_CLASSES[size]} text-overview-text-secondary ${className ?? ""}`}>{children}</p>;
}

/**
 * Etapa "Sprint Workspace Polish 1.0" (Parte 4) — estado vazio em formato de
 * LINHA, para colunas que normalmente são listas em `<ul>` com borda/raio
 * (Tarefas, Otimizações): antes, uma área vazia virava só um `<p>` sem
 * moldura, encolhendo e deixando as duas colunas com pesos visuais bem
 * diferentes quando uma tinha itens e a outra não. Esta variante mantém a
 * mesma moldura (borda + raio) e uma altura mínima próxima da de uma linha
 * real da lista — nunca 3-4 placeholders vazios, sempre uma linha só.
 *
 * Etapa "Sprint Workspace Polish 1.1" (Parte 3): padding e altura mínima
 * ajustados pra bater exatamente com uma linha real de `TaskRow`/otimização
 * (`px-2 py-1`, `min-h-[28px]`) — antes eram valores diferentes, então o
 * estado vazio tinha um ritmo ligeiramente distinto do estado cheio.
 */
export function EmptyStateRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex min-h-[28px] items-center rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
