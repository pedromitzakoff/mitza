"use client";

import { useState } from "react";
import type { UserRole } from "@/lib/supabase/database.types";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * Dono do estado do menu mobile, compartilhado entre o botão "Menu" (Top
 * Bar) e o drawer da sidebar.
 *
 * Hierarquia (Top Bar acima de tudo, largura cheia; Sidebar e conteúdo lado
 * a lado abaixo dela):
 *
 *   AppShell
 *   ├── TopBar            (100% da largura, topo do viewport)
 *   └── Body              (linha: Sidebar + MainArea)
 *       ├── Sidebar        (sticky abaixo da Top Bar, scroll próprio)
 *       └── MainArea       (ClientContextBar + conteúdo da rota)
 *
 * A página continua rolando normalmente (sem trocar pra um shell de altura
 * fixa) — Top Bar, Sidebar e ClientContextBar usam `position: sticky`, que
 * preserva âncoras (`#sprint-...`) e o comportamento nativo de scroll.
 */
export function AppShell({
  profile,
  children,
}: {
  profile: { name: string; role: UserRole };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-full">
      <TopBar onOpenMenu={() => setMobileOpen(true)} />
      <div className="flex md:items-start">
        <Sidebar profile={profile} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
