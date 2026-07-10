"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import {
  Building2,
  LayoutGrid,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Settings,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { syncAllMetaAction } from "@/app/global-actions";
import type { UserRole } from "@/lib/supabase/database.types";
import {
  SIDEBAR_COLLAPSED_WIDTH_CLASS,
  SIDEBAR_EXPANDED_WIDTH_CLASS,
  SIDEBAR_HEIGHT_CLASS,
  TOP_BAR_OFFSET_CLASS,
} from "./app-shell-dimensions";

/**
 * Preferência de sidebar recolhida (só desktop) — fica salva no navegador,
 * não por conta de usuário, é só uma preferência de tela. Lida via
 * useSyncExternalStore (em vez de useState + useEffect) pra não cair no
 * anti-padrão de setState dentro de efeito e pra não gerar mismatch de
 * hydration: o servidor não tem acesso a localStorage, então a snapshot do
 * servidor é sempre "expandida", e o valor real do cliente só substitui
 * depois da hydration — igual ao relógio da Top Bar. Só afeta telas
 * desktop (md+) — o drawer mobile sempre mostra o conteúdo completo.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = "mitza:sidebar-collapsed";
const SIDEBAR_COLLAPSED_EVENT = "mitza:sidebar-collapsed-changed";

function subscribeToCollapsed(callback: () => void) {
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, callback);
  return () => window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, callback);
}

function getCollapsedSnapshot() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
}

function getCollapsedServerSnapshot() {
  return false;
}

function setSidebarCollapsedPreference(value: boolean) {
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
}

interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  isActive?: (pathname: string, mode: string | null) => boolean;
  group: "principal" | "mais";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Visão Geral", href: "/", icon: LayoutGrid, isActive: (p) => p === "/", group: "principal" },
  {
    label: "Clientes",
    href: "/clients",
    icon: Building2,
    isActive: (p) => p === "/clients",
    group: "principal",
  },
  {
    label: "Sprints",
    href: "/sprints",
    icon: ListChecks,
    isActive: (p) => p === "/sprints" || p === "/operation",
    group: "principal",
  },
  { label: "Reuniões", icon: Video, group: "mais" },
  { label: "Equipe", icon: Users, adminOnly: true, group: "mais" },
  {
    label: "Configurações",
    href: "/settings",
    icon: Settings,
    adminOnly: true,
    isActive: (p) => p.startsWith("/settings"),
    group: "mais",
  },
];

/** Label some no desktop quando `collapsed` (só md+ — no drawer mobile o
 * texto sempre aparece, controlado pelas mesmas classes responsivas). */
function ItemLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return <span className={collapsed ? "md:hidden" : ""}>{children}</span>;
}

function NavLink({
  item,
  pathname,
  mode,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  mode: string | null;
  collapsed: boolean;
}) {
  const active = item.isActive ? item.isActive(pathname, mode) : item.href ? pathname.startsWith(item.href) : false;
  const Icon = item.icon;

  if (!item.href) {
    return (
      <span
        title={item.label}
        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-muted-foreground/60 ${collapsed ? "md:justify-center" : ""}`}
      >
        <span className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <ItemLabel collapsed={collapsed}>{item.label}</ItemLabel>
        </span>
        <span className={`text-[10px] uppercase tracking-wide ${collapsed ? "md:hidden" : ""}`}>Em breve</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${collapsed ? "md:justify-center" : ""} ${
        active ? "bg-brand text-white" : "text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <ItemLabel collapsed={collapsed}>{item.label}</ItemLabel>
    </Link>
  );
}

function SidebarContent({
  profile,
  pathname,
  mode,
  collapsed,
}: {
  profile: { name: string; role: UserRole };
  pathname: string;
  mode: string | null;
  collapsed: boolean;
}) {
  const isAdmin = profile.role === "admin";
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const principal = items.filter((item) => item.group === "principal");
  const mais = items.filter((item) => item.group === "mais");
  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex min-h-full flex-col">
      {isAdmin && (
        <div className="p-2.5">
          <Link
            href="/clients/new"
            title="Novo cliente"
            className={`flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover ${collapsed ? "md:px-0" : ""}`}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <ItemLabel collapsed={collapsed}>Novo cliente</ItemLabel>
          </Link>
        </div>
      )}

      <nav className="mt-1 flex flex-col gap-0.5 px-2.5">
        {principal.map((item) => (
          <NavLink key={item.label} item={item} pathname={pathname} mode={mode} collapsed={collapsed} />
        ))}
      </nav>

      {mais.length > 0 && (
        <nav className="mt-2 flex flex-1 flex-col gap-0.5 border-t border-border px-2.5 pt-2">
          {mais.map((item) => (
            <NavLink key={item.label} item={item} pathname={pathname} mode={mode} collapsed={collapsed} />
          ))}
        </nav>
      )}

      {isAdmin && (
        <div className="px-2.5 pb-2">
          <form action={syncAllMetaAction}>
            <button
              type="submit"
              title="Atualizar Meta (todos)"
              className={`flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 ${collapsed ? "md:px-0" : ""}`}
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <ItemLabel collapsed={collapsed}>Atualizar Meta (todos)</ItemLabel>
            </button>
          </form>
        </div>
      )}

      <div className="border-t border-border p-2.5">
        <div className={`flex items-center gap-2 ${collapsed ? "md:justify-center" : ""}`} title={`${profile.name} · ${profile.role === "admin" ? "Admin" : "Gestor"}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
            {initial}
          </span>
          <span className={`min-w-0 ${collapsed ? "md:hidden" : ""}`}>
            <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
            <p className="text-xs text-muted-foreground">{profile.role === "admin" ? "Admin" : "Gestor"}</p>
          </span>
        </div>
        <form action={logout} className="mt-1.5">
          <button
            type="submit"
            title="Sair"
            className={`flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 ${collapsed ? "md:px-0" : ""}`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <ItemLabel collapsed={collapsed}>Sair</ItemLabel>
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

/** O botão "Menu" e o relógio/marca vivem na Top Bar global
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
  const collapsed = useSyncExternalStore(subscribeToCollapsed, getCollapsedSnapshot, getCollapsedServerSnapshot);
  const toggleCollapsed = () => setSidebarCollapsedPreference(!collapsed);

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onClose}
          className={`fixed inset-x-0 bottom-0 z-40 bg-black/30 md:hidden ${TOP_BAR_OFFSET_CLASS}`}
        />
      )}

      <aside
        className={`fixed bottom-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 md:sticky md:bottom-auto md:z-0 md:translate-x-0 md:transition-[width] ${TOP_BAR_OFFSET_CLASS} ${SIDEBAR_HEIGHT_CLASS} ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? SIDEBAR_COLLAPSED_WIDTH_CLASS : SIDEBAR_EXPANDED_WIDTH_CLASS}`}
      >
        <div className={`hidden shrink-0 items-center border-b border-border p-2 md:flex ${collapsed ? "justify-center" : "justify-end"}`}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Suspense
            fallback={<SidebarContent profile={profile} pathname={pathname} mode={null} collapsed={collapsed} />}
          >
            <SidebarMode
              onMode={(mode) => (
                <SidebarContent profile={profile} pathname={pathname} mode={mode} collapsed={collapsed} />
              )}
            />
          </Suspense>
        </div>
      </aside>
    </>
  );
}
