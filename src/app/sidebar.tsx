"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Briefcase,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { syncAllMetaAction } from "@/app/global-actions";
import { SubmitButton } from "@/app/submit-button";
import { formatAgencyDateTime } from "@/lib/format";
import type { UserRole } from "@/lib/supabase/database.types";
import { filterAgencyTreeClients, type AgencyTreeClient } from "@/lib/agency-accounts-tree";
import { buildWorkspaceHref, resolveActiveClientIdFromPathname } from "@/lib/client-workspace-nav";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import {
  ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES,
  ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES,
  ACTIVE_INDICATOR_RAIL_CLASSES,
} from "@/components/ui/active-indicator";
import { SIDEBAR_COLLAPSED_WIDTH_CLASS, SIDEBAR_EXPANDED_WIDTH_CLASS, SIDEBAR_HEIGHT_CLASS } from "./app-shell-dimensions";

/**
 * MITZA ONE — Fase 2: Sidebar = Carteira de Clientes + Header Simplificado.
 * Substitui a navegação por MÓDULO (Fase "MEGA FACELIFT — Fase 4.6": 7
 * itens fixos Growth/Execução) por navegação por CLIENTE: a Sidebar agora
 * é a carteira (busca + lista rolável de clientes reais, já ordenada pela
 * MESMA fonte oficial de sempre — `loadAgencyAccountsTree`/
 * `flattenAgencyTree`, buscada uma vez no layout raiz e repassada via
 * `AppShell`, nenhuma segunda fonte da carteira), seguida de uma área
 * "Agência" compacta com as ferramentas transversais (Demandas/Operação/
 * Timeline globais) e "Gestão" (Clientes/Equipe/Configurações — mesmo
 * grupo de sempre, só realocado).
 *
 * O cockpit único (`/clients/[id]`, MITZA ONE — Fase 1) passa a ser o
 * único destino de clique na carteira — nunca mais um módulo escolhido
 * separadamente. `buildWorkspaceHref(clientId, "", month)` preserva o mês
 * (único parâmetro realmente compartilhado entre clientes) mas NUNCA
 * replica um sufixo de sub-rota — trocar de cliente pela Sidebar sempre
 * abre o cockpit dele, nunca a mesma sub-rota legada que você estava
 * vendo no cliente anterior (seção 4 do pedido: "não vazar... estado que
 * não pertençam ao destino").
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

/** Relógio da agência — migrado da Top Bar (removida na Etapa Global UX
 * Refinement 1.0) para o rodapé da Sidebar. `useSyncExternalStore` pelo
 * mesmo motivo do estado de collapsed acima: o servidor não tem hora real,
 * então a snapshot do servidor é `null` (evita mismatch de hidratação) e o
 * valor de verdade só aparece depois, no cliente. */
function subscribeToClock(callback: () => void) {
  const interval = setInterval(callback, 30_000);
  return () => clearInterval(interval);
}
function getClientNow() {
  return Date.now();
}
function getServerNow() {
  return null;
}

function SidebarClock({ collapsed }: { collapsed: boolean }) {
  const nowMs = useSyncExternalStore(subscribeToClock, getClientNow, getServerNow);

  if (nowMs === null) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground-subtle">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="invisible">00:00</span>
      </div>
    );
  }

  const { weekday, weekdayShort, date, dateShort, time } = formatAgencyDateTime(new Date(nowMs));

  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] text-sidebar-foreground-subtle ${collapsed ? "md:justify-center" : ""}`}
      title={`${weekday} / ${date} / ${time}`}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={collapsed ? "md:hidden" : ""}>
        {weekdayShort} • {dateShort} • {time}
      </span>
    </div>
  );
}

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  isActive: (pathname: string) => boolean;
}

/** "Gestão" — administração/infraestrutura da carteira (busca/filtros/
 * `wallet_position`), nunca navegação do dia a dia (mesmo raciocínio da
 * antiga "Administração"/"Gestão" das fases anteriores — só realocada pra
 * dentro da nova área "Agência" nesta fase, seção 2 do pedido: "pode
 * agrupar Clientes, Equipe e Configurações sob Gestão"). */
const GESTAO_ITEMS: NavItem[] = [
  { label: "Clientes", href: "/clients", icon: Briefcase, isActive: (p) => p === "/clients" || p.startsWith("/clients/new") },
  { label: "Configurações", href: "/settings", icon: Settings, adminOnly: true, isActive: (p) => p.startsWith("/settings") },
];

/**
 * KOFF Analytics — "Adaptar o sistema" (pedido explícito do usuário):
 * dentro do workspace de UM cliente, a Sidebar troca a Carteira (busca +
 * lista de todos os clientes) por este menu de 4 itens — Dashboard/
 * Campanhas/Anúncios/Metas, sempre escopados ao cliente ativo. Trocar de
 * cliente (ou voltar à Carteira) não é mais um item de menu — é o
 * `ClientSwitcher` no topo (ver abaixo), um seletor, não uma rota do
 * cliente. `buildWorkspaceHref` (já existia, suporta sufixo) preserva o
 * mês como sempre fez pra qualquer link do workspace.
 */
export function buildClientNavItems(clientId: string, month: string | null): NavItem[] {
  return [
    { label: "Dashboard", href: buildWorkspaceHref(clientId, "", month), icon: LayoutDashboard, isActive: (p) => p === `/clients/${clientId}` },
    {
      label: "Campanhas",
      href: buildWorkspaceHref(clientId, "/campanhas", month),
      icon: Megaphone,
      isActive: (p) => p.startsWith(`/clients/${clientId}/campanhas`),
    },
    {
      label: "Anúncios",
      href: buildWorkspaceHref(clientId, "/anuncios", month),
      icon: ImageIcon,
      isActive: (p) => p.startsWith(`/clients/${clientId}/anuncios`),
    },
    { label: "Metas", href: buildWorkspaceHref(clientId, "/metas", month), icon: Target, isActive: (p) => p.startsWith(`/clients/${clientId}/metas`) },
  ];
}

/** Label some no desktop quando `collapsed` (só md+ — no drawer mobile o
 * texto sempre aparece, controlado pelas mesmas classes responsivas). Sem
 * espaço reservado: o span some do layout (`hidden`), não só fica invisível. */
function ItemLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return <span className={collapsed ? "md:hidden" : ""}>{children}</span>;
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = item.isActive(pathname);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md ${ACTIVE_INDICATOR_RAIL_CLASSES} py-1 pl-2 pr-2.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel ${collapsed ? "md:justify-center md:border-l-0 md:pl-2.5" : ""} ${
        active ? ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES : ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <ItemLabel collapsed={collapsed}>{item.label}</ItemLabel>
    </Link>
  );
}

/**
 * MITZA ONE — Fase 2.1 (Refinamento da Sidebar, seção 2 do pedido): grupo
 * expansível/colapsável — fechado por padrão, abre ao clicar no título OU
 * automaticamente quando a rota atual pertence ao grupo (estado controlado
 * pelo pai, `SidebarContent`, pra poder fazer esse auto-open sem fechar um
 * grupo que o usuário já abriu manualmente). `<button>` nativo cobre
 * teclado (Enter/Espaço) de graça; `aria-expanded`/`aria-controls` ligam o
 * cabeçalho ao painel (`id` só existe quando aberto, já que o painel nem
 * monta quando fechado — sem animação de altura, mount/unmount simples,
 * "discreta ou nenhuma" por escolha). Chevron rotaciona 90° quando aberto.
 */
function AccordionGroup({
  groupId,
  label,
  navLabel,
  items,
  pathname,
  collapsed,
  open,
  onToggle,
}: {
  groupId: string;
  label: string;
  navLabel: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `sidebar-group-panel-${groupId}`;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center justify-between rounded-md px-0.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground-muted transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:text-sidebar-foreground-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel"
      >
        <span>{label}</span>
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <nav id={panelId} aria-label={navLabel} className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
        </nav>
      )}
    </div>
  );
}

/**
 * Uma linha da carteira — mesmo visual de `NavLink` (reaproveita as
 * classes do "KOFF Active Indicator"), mas o destino é sempre o cockpit
 * (`/clients/[id]`, suffix `""`) e o estado ativo compara contra o ID do
 * cliente extraído do pathname (`resolveActiveClientIdFromPathname`,
 * `lib/client-workspace-nav.ts` — já existia, testado, pensado pra
 * reconhecer o cliente certo mesmo em sub-rotas legadas, seção 4 do
 * pedido: "se o usuário abrir diretamente uma rota antiga do cliente, a
 * sidebar ainda deve destacar o cliente correto").
 */
function ClientRow({
  client,
  activeClientId,
  month,
  collapsed,
}: {
  client: AgencyTreeClient;
  activeClientId: string | null;
  month: string | null;
  collapsed: boolean;
}) {
  const active = client.id === activeClientId;
  const href = buildWorkspaceHref(client.id, "", month);

  return (
    <Link
      href={href}
      title={client.name}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md ${ACTIVE_INDICATOR_RAIL_CLASSES} py-1 pl-2 pr-2.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel ${collapsed ? "md:justify-center md:border-l-0 md:pl-2.5" : ""} ${
        active ? ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES : ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES
      }`}
    >
      <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="xs" />
      <ItemLabel collapsed={collapsed}>
        <span className="truncate">{client.name}</span>
      </ItemLabel>
    </Link>
  );
}

/**
 * Etapa "Revisão da Sidebar — indicador de overflow": detecta se a região
 * de navegação tem mais conteúdo além do que está visível, em cada borda
 * (topo/rodapé) — hoje a scrollbar fica escondida (`mitza-scrollbar-hidden`)
 * sem nenhum outro indício de que dá pra rolar. Reaproveitado nesta fase
 * pra região rolável da CARTEIRA (seção 7 do pedido: "a área da carteira
 * deve rolar independentemente da área de Agência").
 */
function useScrollEdges(): {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  edges: { top: boolean; bottom: boolean };
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    function measure() {
      if (!scrollEl) return;
      const scrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 1;
      setEdges({
        top: scrollable && scrollEl.scrollTop > 1,
        bottom: scrollable && scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 1,
      });
    }

    measure();
    scrollEl.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(contentEl);

    return () => {
      scrollEl.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return { scrollRef, contentRef, edges };
}

/**
 * "Contas" como seletor, não como item de menu (pedido explícito do
 * usuário): no topo do menu do cliente, troca rapidamente de cliente ou
 * volta à Carteira — mesma busca local de sempre (`filterAgencyTreeClients`,
 * `walletClients` já carregado), mesmo padrão de popover ancorado já usado
 * em `SearchableSelect` (busca + lista + "fechar" via overlay invisível).
 * `presentation` escolhe o gatilho (nome completo vs. só avatar), mas as
 * duas instâncias têm estado próprio — nunca compartilhado — porque só uma
 * fica visível por vez (a mesma convenção responsiva de sempre: a Carteira
 * e a tira compacta, acima, também coexistem assim no DOM).
 */
function ClientSwitcher({
  activeClient,
  walletClients,
  month,
  presentation,
}: {
  activeClient: AgencyTreeClient;
  walletClients: AgencyTreeClient[];
  month: string | null;
  presentation: "full" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(() => filterAgencyTreeClients(walletClients, query), [walletClients, query]);

  function openSwitcher() {
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className={presentation === "full" ? "relative" : "relative shrink-0"}>
      {presentation === "full" ? (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openSwitcher())}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="mitza-pressable flex w-full items-center gap-2 rounded-md py-1 pl-1 pr-1.5 text-left hover:bg-sidebar-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel"
        >
          <ClientAvatar name={activeClient.name} imageUrl={activeClient.avatarUrl} size="xs" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">{activeClient.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground-muted" aria-hidden="true" />
        </button>
      ) : (
        <Tooltip label={`Trocar cliente (${activeClient.name})`}>
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openSwitcher())}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="Trocar cliente"
            className="mitza-pressable block rounded-full ring-2 ring-sidebar-active-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel"
          >
            <ClientAvatar name={activeClient.name} imageUrl={activeClient.avatarUrl} size="xs" />
          </button>
        </Tooltip>
      )}

      {open && (
        <>
          <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            className={`mitza-menu-in absolute z-50 w-64 rounded-xl border border-sidebar-border bg-sidebar-surface p-2 shadow-[var(--shadow-float)] ${
              presentation === "compact" ? "left-full top-0 ml-2" : "left-0 top-full mt-1"
            }`}
          >
            <label className="sr-only" htmlFor="sidebar-client-switcher-search">
              Buscar cliente
            </label>
            <input
              ref={inputRef}
              id="sidebar-client-switcher-search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-md border border-sidebar-border bg-transparent px-2 py-1 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground-subtle outline-none focus:border-steel"
            />
            <ul role="listbox" aria-label="Clientes" className="mt-1.5 max-h-56 overflow-y-auto">
              {filtered.map((client) => (
                <li key={client.id} role="option" aria-selected={client.id === activeClient.id}>
                  <Link
                    href={buildWorkspaceHref(client.id, "", month)}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2 truncate rounded-md px-2 py-1 text-xs ${
                      client.id === activeClient.id
                        ? "bg-sidebar-hover font-medium text-sidebar-foreground"
                        : "text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground"
                    }`}
                  >
                    <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="xs" />
                    <span className="truncate">{client.name}</span>
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2 py-1.5 text-xs text-sidebar-foreground-subtle">Nenhum cliente encontrado.</li>}
            </ul>
            <Link
              href="/clients"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground"
            >
              <Briefcase className="h-3 w-3 shrink-0" aria-hidden="true" />
              Ver todos os clientes
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarContent({
  profile,
  pathname,
  month,
  walletClients,
  collapsed,
  toggleCollapsed,
}: {
  profile: { name: string; role: UserRole };
  pathname: string;
  month: string | null;
  walletClients: AgencyTreeClient[];
  collapsed: boolean;
  toggleCollapsed: () => void;
}) {
  const isAdmin = profile.role === "admin";
  const gestaoItems = GESTAO_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";
  const { scrollRef, contentRef, edges } = useScrollEdges();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");

  // MITZA ONE — Fase 2.1 (seção 2 do pedido): Agência/Gestão fechados por
  // padrão; abrem automaticamente quando a rota atual já pertence ao
  // grupo (landing direto numa rota global, ex.: recarregar `/team`) e
  // continuam abrindo (nunca fechando) a cada navegação cuja rota passe a
  // pertencer ao grupo — "OR" com o estado anterior, nunca sobrescreve um
  // grupo que o usuário já abriu manualmente. Ajuste feito DURANTE o
  // render (padrão oficial do React pra "adjusting state when a prop
  // changes": guardar a última pathname vista em ESTADO — nunca em ref,
  // que o React proíbe ler/escrever durante o render — e chamar
  // `setState` direto no corpo quando ela mudou, nunca dentro de
  // `useEffect`), não só por estilo — chamar `setState` de forma
  // síncrona dentro de um efeito aqui causaria um render em cascata
  // extra a cada navegação.
  const [openGroups, setOpenGroups] = useState(() => ({
    gestao: gestaoItems.some((item) => item.isActive(pathname)),
  }));
  const [lastAutoOpenPathname, setLastAutoOpenPathname] = useState(pathname);
  if (lastAutoOpenPathname !== pathname) {
    setLastAutoOpenPathname(pathname);
    setOpenGroups((prev) => ({
      gestao: prev.gestao || gestaoItems.some((item) => item.isActive(pathname)),
    }));
  }

  const activeClientId = resolveActiveClientIdFromPathname(pathname);

  // Busca local (seção 6 do pedido: "sem chamada Supabase por tecla") —
  // `walletClients` já veio pronta/ordenada do layout raiz; filtrar um
  // array de até ~100 itens em memória é instantâneo, nenhum debounce
  // necessário.
  const filteredClients = useMemo(() => filterAgencyTreeClients(walletClients, search), [walletClients, search]);

  const activeClient = activeClientId ? walletClients.find((c) => c.id === activeClientId) ?? null : null;

  function expandAndFocusSearch() {
    toggleCollapsed();
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hidden shrink-0 items-center justify-end px-2 pb-1 pt-1.5 md:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className="hidden shrink-0 rounded-md p-1 text-sidebar-foreground-muted transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel md:block"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {activeClientId ? (
        <>
          {/* MENU DO CLIENTE — dentro do workspace de um cliente, a
              Carteira cede lugar a este menu fixo de 4 itens, sempre
              escopado ao cliente ativo (ver `buildClientNavItems`). O
              nome/avatar do cliente substitui a marca, e funciona como
              SELETOR (`ClientSwitcher`, não um item de menu) — "Contas"
              deixou de ser uma rota pra ser essa troca rápida no topo,
              pedido explícito do usuário. Só na apresentação expandida;
              recolhida mostra só o avatar (mesmo seletor, `presentation="compact"`). */}
          <div className={`flex min-h-0 flex-1 flex-col px-2.5 ${collapsed ? "md:hidden" : ""}`}>
            {activeClient && (
              <div className="mb-2 shrink-0 border-b border-sidebar-border pb-2.5">
                <ClientSwitcher activeClient={activeClient} walletClients={walletClients} month={month} presentation="full" />
              </div>
            )}
            <nav aria-label="Menu do cliente" className="flex flex-col gap-0.5">
              {buildClientNavItems(activeClientId, month).map((item) => (
                <NavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} />
              ))}
            </nav>
          </div>

          <div className={collapsed ? "hidden flex-col items-center gap-1.5 px-2.5 md:flex" : "hidden"}>
            {activeClient && <ClientSwitcher activeClient={activeClient} walletClients={walletClients} month={month} presentation="compact" />}
            {buildClientNavItems(activeClientId, month).map((item) => (
              <Tooltip key={item.label} label={item.label}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={item.isActive(pathname) ? "page" : undefined}
                  className={`mitza-pressable flex h-7 w-7 items-center justify-center rounded-md ${
                    item.isActive(pathname) ? ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES : ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES
                  }`}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Tooltip>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* CARTEIRA — seção 1 do pedido. Busca + lista ficam JUNTAS numa
              região com scroll PRÓPRIO (`flex-1 min-h-0 overflow-y-auto`),
              separada da área "Agência"/"Gestão"/rodapé abaixo (`shrink-0`,
              nunca rola com a carteira). `md:hidden` quando `collapsed`:
              some só no desktop recolhido (mobile sempre mostra tudo,
              mesmo padrão de sempre — ver `ItemLabel`); o bloco compacto
              equivalente (abaixo) faz o inverso (`hidden md:flex` quando
              `collapsed`). Só aparece FORA do workspace de um cliente —
              dentro dele, o menu do cliente (acima) toma o lugar. */}
          <div className={`flex min-h-0 flex-1 flex-col px-2.5 ${collapsed ? "md:hidden" : ""}`}>
            <label className="sr-only" htmlFor="sidebar-client-search">
              Buscar cliente
            </label>
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground-subtle" aria-hidden="true" />
              <input
                ref={searchInputRef}
                id="sidebar-client-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full rounded-md bg-sidebar-search-surface py-1.5 pl-7 pr-2 text-[13px] text-sidebar-foreground placeholder:text-sidebar-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel"
              />
            </div>

            <div className="relative mt-2 min-h-0 flex-1">
              <div ref={scrollRef} className="mitza-scrollbar-hidden h-full overflow-y-auto">
                <div ref={contentRef}>
                  <nav aria-label="Carteira de clientes" className="flex flex-col gap-0.5 pb-1">
                    {filteredClients.map((client) => (
                      <ClientRow key={client.id} client={client} activeClientId={activeClientId} month={month} collapsed={collapsed} />
                    ))}
                  </nav>
                  {walletClients.length === 0 && <p className="px-0.5 py-2 text-xs text-sidebar-foreground-subtle">Nenhum cliente na carteira ainda.</p>}
                  {walletClients.length > 0 && filteredClients.length === 0 && (
                    <p className="px-0.5 py-2 text-xs text-sidebar-foreground-subtle">Nenhum cliente encontrado.</p>
                  )}
                </div>
              </div>
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-sidebar-surface to-transparent transition-opacity duration-150 ${edges.top ? "opacity-100" : "opacity-0"}`}
              />
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-sidebar-surface to-transparent transition-opacity duration-150 ${edges.bottom ? "opacity-100" : "opacity-0"}`}
              />
            </div>
          </div>

          {/* Versão compacta pro desktop recolhido (seção 5 do pedido: "sem
              lista de dezenas de ícones indistinguíveis") — só o cliente
              ATUAL (se houver) + um gatilho que expande a Sidebar e foca a
              busca. `hidden md:flex`: nunca aparece no mobile (a carteira
              completa acima já cobre esse caso) nem no desktop expandido. */}
          <div className={collapsed ? "hidden flex-col items-center gap-1.5 px-2.5 md:flex" : "hidden"}>
            <Tooltip label="Buscar cliente">
              <button
                type="button"
                onClick={expandAndFocusSearch}
                aria-label="Buscar cliente"
                className="mitza-pressable flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground-muted hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </>
      )}

      {/* AGÊNCIA + GESTÃO — seção 2 do pedido: ferramentas transversais,
          nunca módulos do cliente. Fixo abaixo da carteira, nunca rola
          junto com ela (`shrink-0`). Fase 2.1: dois grupos expansíveis
          (fechados por padrão, abrem no clique ou automaticamente pra
          revelar a rota atual — ver `openGroups` acima) — só na
          apresentação com rótulos (mobile sempre; desktop expandido).
          `md:hidden` quando `collapsed`: some só no desktop recolhido,
          mesma convenção da carteira (ver comentário acima). */}
      <div className={`mt-2 shrink-0 space-y-1.5 px-2.5 pb-2 ${collapsed ? "md:hidden" : ""}`}>
        {gestaoItems.length > 0 && (
          <AccordionGroup
            groupId="gestao"
            label="Gestão"
            navLabel="Gestão da agência"
            items={gestaoItems}
            pathname={pathname}
            collapsed={collapsed}
            open={openGroups.gestao}
            onToggle={() => setOpenGroups((prev) => ({ ...prev, gestao: !prev.gestao }))}
          />
        )}
      </div>

      {/* Tira de ícones plana pro desktop recolhido (seção 5 da Fase 2:
          "sem lista de dezenas de ícones indistinguíveis" — aqui só 6
          ícones fixos, não a carteira). O acordeão da Fase 2.1 só existe
          na apresentação com rótulos; recolhida continua sem cabeçalho
          clicável nem estado de aberto/fechado, comportamento idêntico ao
          de antes desta fase. `hidden md:flex`: nunca aparece no mobile
          (o bloco com rótulos acima já cobre esse caso). */}
      <div className={collapsed ? "hidden shrink-0 flex-col gap-0.5 px-2.5 pb-2 md:flex" : "hidden"}>
        {gestaoItems.map((item) => (
          <NavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </div>

      {/* RODAPÉ — sempre visível, uma borda sutil separando do resto. */}
      <div className="shrink-0 space-y-1.5 border-t border-sidebar-border p-2.5">
        <SidebarClock collapsed={collapsed} />

        {isAdmin && (
          <form action={syncAllMetaAction}>
            <Tooltip label="Atualizar Meta (todos)">
              <SubmitButton
                pendingChildren={
                  <>
                    <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <ItemLabel collapsed={collapsed}>Atualizando...</ItemLabel>
                  </>
                }
                className={`flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-[11px] text-sidebar-foreground-subtle transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:text-sidebar-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel ${collapsed ? "md:justify-center" : ""}`}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <ItemLabel collapsed={collapsed}>Atualizar Meta (todos)</ItemLabel>
              </SubmitButton>
            </Tooltip>
          </form>
        )}

        <div
          className={`flex items-center gap-2 pt-0.5 ${collapsed ? "md:justify-center" : ""}`}
          title={`${profile.name} · ${profile.role === "admin" ? "Admin" : "Gestor"}`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-search-surface text-xs font-semibold text-sidebar-foreground">
            {initial}
          </span>
          <span className={`min-w-0 ${collapsed ? "md:hidden" : ""}`}>
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {profile.name}{" "}
              <span className="font-normal text-sidebar-foreground-muted">· {profile.role === "admin" ? "Admin" : "Gestor"}</span>
            </p>
          </span>
        </div>
        <form action={logout}>
          <Tooltip label="Sair">
            <button
              type="submit"
              className={`mitza-pressable flex w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border px-3 py-1 text-xs font-medium text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel ${collapsed ? "md:px-0" : ""}`}
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <ItemLabel collapsed={collapsed}>Sair</ItemLabel>
            </button>
          </Tooltip>
        </form>
      </div>
    </div>
  );
}

/** Lê `?month=` via `useSearchParams()` (precisa de `Suspense`). */
function SidebarMonthParam({ onMonth }: { onMonth: (month: string | null) => React.ReactNode }) {
  const searchParams = useSearchParams();
  return <>{onMonth(searchParams.get("month"))}</>;
}

/**
 * A Sidebar é o único elemento estrutural fixo da plataforma (Decisão 012 —
 * a Top Bar global foi removida): superfície Azul Marinho sólida permanente
 * ("Identidade Visual KOFF Oficial" — não acompanha o tema claro/escuro do
 * resto da aplicação, ver tokens `--sidebar-*` em `globals.css`). A Sidebar ocupa exatamente 100%
 * da altura da viewport em qualquer breakpoint (`SIDEBAR_HEIGHT_CLASS`) e é
 * o principal elemento de navegação da plataforma. No mobile ela continua
 * sendo um drawer; o próprio componente expõe um gatilho flutuante
 * (`onOpen`) — só visível no mobile e só quando o drawer está fechado.
 */
export function Sidebar({
  profile,
  walletClients,
  mobileOpen,
  onOpen,
  onClose,
}: {
  profile: { name: string; role: UserRole };
  walletClients: AgencyTreeClient[];
  mobileOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeToCollapsed, getCollapsedSnapshot, getCollapsedServerSnapshot);
  const toggleCollapsed = () => setSidebarCollapsedPreference(!collapsed);

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Abrir menu"
          className="mitza-pressable fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-surface text-sidebar-foreground shadow-[var(--shadow-float)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel md:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onClose}
          className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar-surface transition-transform duration-200 md:sticky md:top-0 md:z-0 md:translate-x-0 md:border-r md:border-sidebar-border md:transition-[width] ${SIDEBAR_HEIGHT_CLASS} ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? SIDEBAR_COLLAPSED_WIDTH_CLASS : SIDEBAR_EXPANDED_WIDTH_CLASS}`}
      >
        <Suspense
          fallback={
            <SidebarContent profile={profile} pathname={pathname} month={null} walletClients={walletClients} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
          }
        >
          <SidebarMonthParam
            onMonth={(month) => (
              <SidebarContent profile={profile} pathname={pathname} month={month} walletClients={walletClients} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
            )}
          />
        </Suspense>
      </aside>
    </>
  );
}
