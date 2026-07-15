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
