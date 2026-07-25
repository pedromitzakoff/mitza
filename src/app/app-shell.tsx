"use client";

import { useState } from "react";
import type { UserRole } from "@/lib/supabase/database.types";
import { Sidebar } from "./sidebar";
import { WorkspaceProvider } from "@/components/workspace-drawer/workspace-provider";
import { WorkspaceTrigger } from "@/components/workspace-drawer/workspace-trigger";
import { WorkspaceDrawer } from "@/components/workspace-drawer/workspace-drawer";

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
 *
 * MITZA 2.0 — Workspace Pessoal: `WorkspaceProvider` envolve tudo (persiste
 * entre navegações, já que este componente não desmonta ao trocar de rota)
 * e o gatilho + drawer ficam como irmãos da árvore Sidebar/MainArea, nunca
 * dentro dela — de propósito, pra nunca virarem parte da navegação
 * principal.
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
    <WorkspaceProvider>
      <div className="flex min-h-dvh md:items-start">
        <Sidebar
          profile={profile}
          agencyTree={agencyTree}
          mobileOpen={mobileOpen}
          onOpen={() => setMobileOpen(true)}
          onClose={() => setMobileOpen(false)}
        />
        {/* Etapa "Fundo branco autenticado": --authenticated-bg aplicado aqui,
            no nível do shell — toda rota autenticada herda o mesmo fundo
            branco sem precisar de override próprio. min-h-dvh garante que
            o fundo cubra a viewport inteira mesmo em páginas curtas (o pai
            usa md:items-start, que não estica o <main> no desktop). */}
        <main className="min-h-dvh min-w-0 flex-1 bg-authenticated-bg">{children}</main>
      </div>
      <WorkspaceTrigger />
      <WorkspaceDrawer />
    </WorkspaceProvider>
  );
}
