"use client";

import { useEffect, useRef, useState } from "react";
import { TOP_BAR_HEIGHT_PX, TOP_BAR_OFFSET_CLASS } from "@/app/app-shell-dimensions";

/**
 * Identificação mínima do cliente durante a rolagem — único elemento
 * client-side desta página, porque posição de scroll não dá pra saber em
 * CSS puro (diferente do resto do sistema, que usa só <details>/checkbox
 * hack). Um sentinela de 1px marca o fim do cabeçalho principal; quando ele
 * sai da área visível abaixo da Top Bar global, mostra só nome + status —
 * sem gestor, conta Meta, período ou ações, que já estão no cabeçalho
 * completo. Some sozinho ao rolar de volta pro topo.
 */
export function ClientIdentitySticky({
  clientName,
  statusLabel,
  statusBadgeClass,
}: {
  clientName: string;
  statusLabel: string;
  statusBadgeClass: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showMinimal, setShowMinimal] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => setShowMinimal(!entry.isIntersecting), {
      rootMargin: `-${TOP_BAR_HEIGHT_PX}px 0px 0px 0px`,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {showMinimal && (
        <div className={`fixed inset-x-0 z-20 border-b border-border bg-card ${TOP_BAR_OFFSET_CLASS}`}>
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-1.5">
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
