"use client";

import { useState } from "react";
import type { UserRole } from "@/lib/supabase/database.types";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/** Dono do estado do menu mobile, compartilhado entre o botão "Menu" (Top
 * Bar) e o drawer da sidebar — antes esse estado vivia dentro da própria
 * Sidebar, mas agora quem abre o menu é a Top Bar. */
export function AppShell({
  profile,
  children,
}: {
  profile: { name: string; role: UserRole };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <Sidebar profile={profile} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
