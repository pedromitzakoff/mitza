"use client";

import { useState } from "react";
import type { UserRole } from "@/lib/supabase/database.types";
import { Sidebar } from "./sidebar";

/**
 * Dono do estado do menu mobile, compartilhado entre o gatilho flutuante e
 * o drawer, ambos dentro da própria Sidebar.
 *
 * Hierarquia (Etapa Global UX Refinement 1.0 — a Top Bar global foi
 * removida; a Sidebar é agora o único elemento estrutural fixo, ocupando
 * 100% da altura da viewport):
 *
 *   AppShell
 *   └── Body              (linha: Sidebar + MainArea, sem cabeçalho acima)
 *       ├── Sidebar        (sticky, altura cheia, scroll próprio)
 *       └── MainArea       (ClientContextBar + conteúdo da rota)
 *
 * A página continua rolando normalmente (sem trocar pra um shell de altura
 * fixa) — Sidebar e ClientContextBar usam `position: sticky`, que preserva
 * âncoras (`#sprint-...`) e o comportamento nativo de scroll.
 */
export function AppShell({
  profile,
  agencyTree,
  children,
}: {
  profile: { name: string; role: UserRole };
  agencyTree?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh md:items-start">
      <Sidebar
        profile={profile}
        agencyTree={agencyTree}
        mobileOpen={mobileOpen}
        onOpen={() => setMobileOpen(true)}
        onClose={() => setMobileOpen(false)}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
