"use client";

import { useEffect, useRef, useState } from "react";
import { ClientAvatar } from "@/components/workspace/client-avatar";

/**
 * Identificação mínima do cliente durante a rolagem — único elemento
 * client-side desta página, porque posição de scroll não dá pra saber em
 * CSS puro (diferente do resto do sistema, que usa só <details>/checkbox
 * hack). Um sentinela de 1px marca o fim do cabeçalho principal; quando ele
 * sai da área visível no topo (não há mais Top Bar global desde a Etapa
 * Global UX Refinement 1.0 — a Sidebar não ocupa a largura do conteúdo,
 * então não há altura nenhuma a descontar), mostra só avatar + nome +
 * status — sem gestor, conta Meta, período ou ações, que já estão no
 * cabeçalho completo. Some sozinho ao rolar de volta pro topo.
 */
export function ClientIdentitySticky({
  clientName,
  avatarUrl,
  statusLabel,
  statusBadgeClass,
}: {
  clientName: string;
  avatarUrl: string | null;
  statusLabel: string;
  statusBadgeClass: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showMinimal, setShowMinimal] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => setShowMinimal(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {showMinimal && (
        <div className="fixed inset-x-0 top-0 z-20 border-b border-border bg-card">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-1.5">
            <ClientAvatar name={clientName} imageUrl={avatarUrl} size="xs" />
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{clientName}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
