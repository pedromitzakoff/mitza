"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { logout } from "@/app/login/actions";
import { syncAllMetaAction } from "@/app/global-actions";
import type { UserRole } from "@/lib/supabase/database.types";

interface NavItem {
  label: string;
  href?: string;
  adminOnly?: boolean;
  isActive?: (pathname: string, mode: string | null) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Visão Geral", href: "/", isActive: (p) => p === "/" },
  {
    label: "Operação",
    href: "/operation",
    isActive: (p, mode) => p === "/operation" && mode !== "hoje",
  },
  {
    label: "Tarefas",
    href: "/operation?mode=hoje",
    isActive: (p, mode) => p === "/operation" && mode === "hoje",
  },
  { label: "Reuniões" },
  { label: "Equipe", adminOnly: true },
  { label: "Configurações", href: "/settings", adminOnly: true, isActive: (p) => p.startsWith("/settings") },
];

function NavLink({ item, pathname, mode }: { item: NavItem; pathname: string; mode: string | null }) {
  const active = item.isActive ? item.isActive(pathname, mode) : item.href ? pathname.startsWith(item.href) : false;

  if (!item.href) {
    return (
      <span className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60">
        {item.label}
        <span className="text-[10px] uppercase tracking-wide">Em breve</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={`block rounded-md px-3 py-2 text-sm font-medium ${
        active
          ? "bg-brand text-white"
          : "text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
      }`}
    >
      {item.label}
    </Link>
  );
}

function SidebarContent({
  profile,
  pathname,
  mode,
}: {
  profile: { name: string; role: UserRole };
  pathname: string;
  mode: string | null;
}) {
  const isAdmin = profile.role === "admin";
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col">
      {isAdmin && (
        <div className="p-3">
          <Link
            href="/clients/new"
            className="block rounded-md bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-hover"
          >
            + Novo cliente
          </Link>
        </div>
      )}

      <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-3">
        {items.map((item) => (
          <NavLink key={item.label} item={item} pathname={pathname} mode={mode} />
        ))}
      </nav>

      {isAdmin && (
        <div className="px-3 pb-2">
          <form action={syncAllMetaAction}>
            <button
              type="submit"
              className="w-full rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Atualizar Meta (todos)
            </button>
          </form>
        </div>
      )}

      <div className="border-t border-border p-3">
        <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
        <p className="text-xs text-muted-foreground">{profile.role === "admin" ? "Admin" : "Gestor"}</p>
        <form action={logout} className="mt-2">
          <button
            type="submit"
            className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}

function SidebarMode({ onMode }: { onMode: (mode: string | null) => React.ReactNode }) {
  const searchParams = useSearchParams();
  return <>{onMode(searchParams.get("mode"))}</>;
}

/** O botão "Menu" e o relógio/marca agora vivem na Top Bar global
 * (src/app/top-bar.tsx); a Sidebar recebe o estado do drawer mobile por
 * fora (dono é o AppShell) em vez de administrar o seu próprio. */
export function Sidebar({
  profile,
  mobileOpen,
  onClose,
}: {
  profile: { name: string; role: UserRole };
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card transition-transform md:sticky md:top-0 md:z-0 md:h-screen md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Suspense fallback={<SidebarContent profile={profile} pathname={pathname} mode={null} />}>
          <SidebarMode onMode={(mode) => <SidebarContent profile={profile} pathname={pathname} mode={mode} />} />
        </Suspense>
      </aside>
    </>
  );
}
