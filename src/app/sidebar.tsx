"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Clock,
  Database,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { syncAllMetaAction } from "@/app/global-actions";
import { SubmitButton } from "@/app/submit-button";
import { formatAgencyDateTime } from "@/lib/format";
import type { UserRole } from "@/lib/supabase/database.types";
import { buildModuleContextHref, resolveCurrentModuleAndContext, resolveModuleLinkContext, type AppContext, type ModuleKey } from "@/lib/client-workspace-nav";
import {
  ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES,
  ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES,
  ACTIVE_INDICATOR_RAIL_CLASSES,
} from "@/components/ui/active-indicator";
import { SIDEBAR_COLLAPSED_WIDTH_CLASS, SIDEBAR_EXPANDED_WIDTH_CLASS, SIDEBAR_HEIGHT_CLASS } from "./app-shell-dimensions";

/**
 * Preferência de sidebar recolhida (só desktop) — fica salva no navegador,
 * não por conta de usuário, é só uma preferência de tela. Lida via
 * useSyncExternalStore (em vez de useState + useEffect) pra não cair no
 * anti-padrão de setState dentro de efeito e pra não gerar mismatch de
 * hydration: o servidor não tem acesso a localStorage, então a snapshot do
 * servidor é sempre "expandida", e o valor real do cliente só substitui
 * depois da hydration — igual ao relógio do rodapé. Só afeta telas
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

/** Relógio da agência — migrado da Top Bar (removida na Etapa Global UX
 * Refinement 1.0) para o rodapé da Sidebar. `useSyncExternalStore` pelo
 * mesmo motivo do estado de collapsed acima: o servidor não tem hora real,
 * então a snapshot do servidor é `null` (evita mismatch de hydration) e o
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

/** Expandida: texto discreto "Ter • 14 Jul • 16:42" (baixo contraste, nunca
 * compete com a navegação). Recolhida (só md+, via `md:hidden` no texto):
 * some o texto, fica só o ícone — com o dia/data/hora completos no
 * `title`, que os navegadores mostram como tooltip nativo ao passar o
 * mouse. Mobile não tem hover, mas nunca fica recolhido (o `collapsed`
 * salvo é uma preferência só de desktop, e as classes que o escondem levam
 * o prefixo `md:`), então o texto aparece sempre que o drawer está aberto. */
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

/**
 * Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como Contexto
 * Global": GESTÃO — administração/infraestrutura, nunca um nível
 * operacional (mesmo raciocínio da antiga "Administração", Etapa "MITZA
 * 2.0 — Fase H"). "Clientes" entrou aqui nesta fase (antes vivia junto
 * dos módulos operacionais, Fase 4.5) — não é mais necessária pra
 * simplesmente TROCAR de contexto durante o uso normal (isso agora é o
 * seletor do header/`GlobalScopeSelect`), só pra localizar/organizar a
 * carteira (busca, filtros, wallet_position) — tarefa de gestão, não de
 * navegação do dia a dia (seção 11 do pedido). */
const GESTAO_ITEMS: NavItem[] = [
  { label: "Clientes", href: "/clients", icon: Briefcase, isActive: (p) => p === "/clients" || p.startsWith("/clients/new") },
  { label: "Equipe", href: "/team", icon: Users, isActive: (p) => p.startsWith("/team") },
  { label: "Configurações", href: "/settings", icon: Settings, adminOnly: true, isActive: (p) => p.startsWith("/settings") },
];

interface ModuleItem {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
  group: "growth" | "execucao";
}

/**
 * Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como Contexto
 * Global" — substitui a dualidade anterior ("Carteira" com Visão Geral/
 * Operação/Demandas/Timeline GLOBAIS + "Cliente" com os mesmos nomes
 * duplicados dentro do workspace) por UMA lista única de 7 módulos,
 * SEMPRE visíveis, SEMPRE no mesmo lugar — "Visão Geral" deixou de
 * existir como item próprio (virou "Dashboard" + contexto "Todos", seção
 * 4 do pedido). MÓDULO é fixo; CLIENTE é só o CONTEXTO que decide o
 * escopo (`AppContext`, `lib/client-workspace-nav.ts`) — cada item
 * resolve seu próprio destino via `buildModuleContextHref(key, context,
 * month)`, o único lugar que sabe montar essa URL (nunca uma segunda
 * lógica de pathname aqui). `/relatorio` continua o nome técnico da rota
 * de Performance (nenhum link/PDF/`/r/[token]` muda) — só o rótulo aqui é
 * "Performance".
 */
const MODULES: ModuleItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "growth" },
  { key: "metas", label: "Metas", icon: Target, group: "growth" },
  { key: "performance", label: "Performance", icon: BarChart3, group: "growth" },
  { key: "dados", label: "Dados", icon: Database, group: "growth" },
  { key: "operation", label: "Operação", icon: ListChecks, group: "execucao" },
  { key: "demandas", label: "Demandas", icon: ClipboardList, group: "execucao" },
  { key: "timeline", label: "Timeline", icon: History, group: "execucao" },
];

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

  // Etapa "KOFF Sidebar Polish": estado ativo formalizado como o "KOFF
  // Active Indicator" (`components/ui/active-indicator.ts`) — mesmas
  // classes agora nomeadas/centralizadas, nenhuma mudança visual além do
  // ajuste de espessura da barra (2px -> ~3px, alinhado à especificação
  // do padrão).
  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex items-center gap-2 rounded-md ${ACTIVE_INDICATOR_RAIL_CLASSES} py-1 pl-2 pr-2.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand ${collapsed ? "md:justify-center md:border-l-0 md:pl-2.5" : ""} ${
        active ? ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES : ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <ItemLabel collapsed={collapsed}>{item.label}</ItemLabel>
    </Link>
  );
}

/**
 * Item de módulo (Etapa "MEGA FACELIFT — Fase 4.6") — mesmo visual de
 * `NavLink` (reaproveita as classes do "KOFF Active Indicator"), mas o
 * destino é montado por `buildModuleContextHref` (preserva `?month=` só
 * no contexto de cliente, mesmo mecanismo já usado por
 * `ClientWorkspaceHeader`/anterior-próximo — nunca uma segunda forma de
 * montar a URL) e o estado ativo compara contra `currentModule`
 * (`resolveCurrentModuleAndContext`), não contra `pathname` bruto.
 */
function ModuleLink({
  item,
  context,
  currentModule,
  month,
  collapsed,
}: {
  item: ModuleItem;
  context: AppContext;
  currentModule: ModuleKey | null;
  month: string | null;
  collapsed: boolean;
}) {
  const active = item.key === currentModule;
  const Icon = item.icon;
  // Etapa "Demandas sempre abre em Todos por padrão": Demandas ignora o
  // contexto ambiente aqui (`resolveModuleLinkContext`) — é a lista do
  // que precisa ser feito na agência toda, nunca só a fração de um
  // cliente por estar "de passagem" nele. Os outros 6 módulos continuam
  // preservando o cliente atual, como sempre.
  const href = buildModuleContextHref(item.key, resolveModuleLinkContext(item.key, context), month);

  return (
    <Link
      href={href}
      title={item.label}
      className={`flex items-center gap-2 rounded-md ${ACTIVE_INDICATOR_RAIL_CLASSES} py-1 pl-2 pr-2.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand ${collapsed ? "md:justify-center md:border-l-0 md:pl-2.5" : ""} ${
        active ? ACTIVE_INDICATOR_SIDEBAR_ACTIVE_CLASSES : ACTIVE_INDICATOR_SIDEBAR_INACTIVE_CLASSES
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <ItemLabel collapsed={collapsed}>{item.label}</ItemLabel>
    </Link>
  );
}

/**
 * Etapa "Revisão da Sidebar — indicador de overflow": detecta se a região
 * de navegação tem mais conteúdo além do que está visível, em cada borda
 * (topo/rodapé) — hoje a scrollbar fica escondida (`mitza-scrollbar-hidden`)
 * sem nenhum outro indício de que dá pra rolar, o que pode esconder pastas
 * de gestor numa agência com muitos gestores.
 *
 * `contentRef` (altura natural, cresce com o conteúdo) é observado via
 * `ResizeObserver` — necessário porque `scrollRef` (o container com
 * `overflow-y-auto`) tem altura FIXA (via flex), então abrir/fechar uma
 * pasta de gestor nunca redimensiona `scrollRef` em si, só o conteúdo
 * dentro dele. Sem essa distinção, o indicador nunca reagiria a pastas
 * abrindo/fechando, só a scroll manual.
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

function SidebarContent({
  profile,
  pathname,
  month,
  collapsed,
  toggleCollapsed,
}: {
  profile: { name: string; role: UserRole };
  pathname: string;
  month: string | null;
  collapsed: boolean;
  toggleCollapsed: () => void;
}) {
  const isAdmin = profile.role === "admin";
  const gestaoItems = GESTAO_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";
  const { scrollRef, contentRef, edges } = useScrollEdges();

  // Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como
  // Contexto Global" — núcleo único que resolve módulo ATIVO (pra
  // destacar o item certo) e contexto ATIVO (Todos ou um cliente) a
  // partir do pathname, nunca uma segunda lógica de pathname aqui (seção
  // 17 do pedido). Substitui `activeClientId`/`currentSuffix` da Fase 1 —
  // mesma fonte (`resolveActiveClientIdFromPathname`/`resolveCurrentSuffix`
  // internamente), só consolidada num resultado único.
  const { module: currentModule, context } = resolveCurrentModuleAndContext(pathname);
  const growthItems = MODULES.filter((item) => item.group === "growth");
  const execucaoItems = MODULES.filter((item) => item.group === "execucao");

  return (
    <div className="flex h-full flex-col">
      {/* Etapa "Identidade Visual KOFF — Sidebar": "Novo cliente" saiu
       * daqui — cadastrar cliente é ação rara, não deveria abrir a
       * Sidebar inteira com um CTA de largura total competindo com a
       * navegação. Vira um "+" discreto ao lado do rótulo "Contas da
       * Agência" (ver agency-accounts-tree-client.tsx), disponível sem
       * roubar atenção. Este topo agora é só o controle de
       * recolher/expandir (estrutural, não é destino de navegação).
       *
       * Etapa "KOFF Sidebar Polish": padding vertical enxuto de propósito
       * — sem o CTA de antes, a mesma altura generosa virava vazio puro
       * entre o botão e "Visão Geral". Ainda sobra um respiro pequeno
       * (não gruda o botão na borda nem no primeiro item), só não é mais
       * uma linha inteira ociosa. */}
      <div className="flex shrink-0 items-center justify-end px-2 pb-1 pt-1.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className="hidden shrink-0 rounded-md p-1 text-sidebar-foreground-muted transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand md:block"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Região com scroll próprio: só a navegação rola se não couber —
       * rodapé (usuário/sair) fica sempre visível, fora desta região.
       * Etapa "Revisão da Sidebar": envolvida num wrapper `relative` pra
       * caber os fades de overflow abaixo, sem mudar nada do scroll/drag-
       * and-drop já existente — os fades são só `pointer-events-none`,
       * nunca interceptam clique nem toque. */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="mitza-scrollbar-hidden h-full overflow-y-auto">
          <div ref={contentRef} className="flex min-h-full flex-col">
            {/* Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente
             * como Contexto Global" (seções 2/3/18 do pedido): MÓDULO é
             * fixo — Growth/Execução SEMPRE visíveis, no MESMO lugar,
             * independente de contexto (Todos ou um cliente específico).
             * Deixou de existir "Carteira" com 4 itens globais + "Cliente"
             * com os mesmos 7 duplicados dentro do workspace — cada
             * `ModuleLink` resolve seu PRÓPRIO destino (`buildModuleContextHref`)
             * a partir do contexto atual, nunca mais uma lista condicional
             * a `activeClientId`. O nome do cliente ativo (quando houver)
             * agora vive só no HEADER (`ClientWorkspaceHeader`/escopo
             * global) — a Sidebar nunca repete avatar/status/posição nem
             * nome de cliente (seção 18: "não mostrar nome do cliente
             * dentro da sidebar"). */}
            <div className="flex flex-col gap-0.5 px-2.5">
              <span className={`px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground-muted ${collapsed ? "md:hidden" : ""}`}>
                Growth
              </span>
              <nav className="flex flex-col gap-0.5">
                {growthItems.map((item) => (
                  <ModuleLink key={item.key} item={item} context={context} currentModule={currentModule} month={month} collapsed={collapsed} />
                ))}
              </nav>
            </div>

            <div className="mt-3 flex flex-col gap-0.5 px-2.5">
              <span className={`px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground-muted ${collapsed ? "md:hidden" : ""}`}>
                Execução
              </span>
              <nav className="flex flex-col gap-0.5">
                {execucaoItems.map((item) => (
                  <ModuleLink key={item.key} item={item} context={context} currentModule={currentModule} month={month} collapsed={collapsed} />
                ))}
              </nav>
            </div>

            <div className="flex-1" />

            {gestaoItems.length > 0 && (
              <div className="flex flex-col gap-0.5 px-2.5 pb-2">
                {/* Etapa "MITZA 2.0 — Fase H" (renomeada "Gestão" na Fase
                 * 4.6): rótulo visual só pra deixar explícito que Clientes/
                 * Equipe/Configurações são administração — infraestrutura
                 * fora da hierarquia operacional, nunca um terceiro nível
                 * ao lado de Growth/Execução. "Atualizar Meta (todos)" não
                 * é uma rota, é uma ação técnica; vive no rodapé, junto do
                 * relógio, com peso visual secundário. */}
                <span className={`px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground-muted ${collapsed ? "md:hidden" : ""}`}>
                  Gestão
                </span>
                <nav className="flex flex-col gap-0.5">
                  {gestaoItems.map((item) => (
                    <NavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} />
                  ))}
                </nav>
              </div>
            )}
          </div>
        </div>

        {/* Etapa "Revisão da Sidebar — indicador de overflow": fade sutil
         * no topo/rodapé da região de navegação quando há mais conteúdo pra
         * rolar além do visível (`edges`, `useScrollEdges` acima) — nunca
         * aparece se o conteúdo já couber inteiro. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-sidebar-surface to-transparent transition-opacity duration-150 ${edges.top ? "opacity-100" : "opacity-0"}`}
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-sidebar-surface to-transparent transition-opacity duration-150 ${edges.bottom ? "opacity-100" : "opacity-0"}`}
        />
      </div>

      {/* RODAPÉ — sempre visível, uma borda sutil separando do resto.
       * Relógio da agência (data/hora globais, migrados da Top Bar) fica
       * aqui, acima da identidade do usuário — discreto, nunca competindo
       * com a navegação (Etapa Global UX Refinement 1.0). */}
      <div className="shrink-0 space-y-1.5 border-t border-sidebar-border p-2.5">
        <SidebarClock collapsed={collapsed} />

        {/* Etapa "Revisão da Sidebar": movido do grupo "Administração" pra
         * cá — não é uma rota, é uma ação técnica (dispara sync manual do
         * Meta), então recebe o mesmo peso visual discreto do relógio
         * acima (11px), nunca competindo com Equipe/Configurações. Mesmo
         * tom `--sidebar-foreground-subtle` do relógio — reforça que isto é
         * rodapé técnico, não mais um item de navegação. */}
        {isAdmin && (
          <form action={syncAllMetaAction}>
            <Tooltip label="Atualizar Meta (todos)">
              {/* Etapa "Padronização Global de Feedback": ação GLOBAL (roda
                  pra todos os clientes) — antes sem nenhum sinal de "em
                  andamento" nem proteção contra clique duplo. `SubmitButton`
                  cobre os dois de graça (mesmo padrão do resto da
                  plataforma), sem mudar a Server Action nem o peso visual
                  discreto já deliberado pra esta ação (ver comentário da
                  Etapa "Revisão da Sidebar" logo acima). */}
              <SubmitButton
                pendingChildren={
                  <>
                    <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <ItemLabel collapsed={collapsed}>Atualizando...</ItemLabel>
                  </>
                }
                className={`flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-[11px] text-sidebar-foreground-subtle transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:text-sidebar-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand ${collapsed ? "md:justify-center" : ""}`}
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
          {/* Grafite de baixa intensidade (`-search-surface`, mesmo tom
           * recortado do campo de busca) em vez do bloco 100% grafite do
           * item ativo — um círculo grafite pesado no rodapé competiria com
           * a navegação; e um overlay simples de hover ficaria fraco demais
           * pra dar definição própria ao círculo sobre o off-white. */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-search-surface text-xs font-semibold text-sidebar-foreground">
            {initial}
          </span>
          {/* Etapa "Identidade Visual KOFF — Sidebar": nome + papel numa
           * linha só (era 2 linhas) — rodapé mais compacto, papel como
           * sufixo discreto em vez de linha própria. */}
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
              className={`mitza-pressable flex w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border px-3 py-1 text-xs font-medium text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand ${collapsed ? "md:px-0" : ""}`}
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

/** Lê `?month=` via `useSearchParams()` (precisa de `Suspense`, ver uso
 * abaixo) — `?mode=` (Etapa anterior a esta fase) nunca foi consumido por
 * nenhum item de navegação; removido junto da consolidação dos módulos
 * fixos (Fase 4.6), nenhuma funcionalidade real perdida. */
function SidebarMonthParam({ onMonth }: { onMonth: (month: string | null) => React.ReactNode }) {
  const searchParams = useSearchParams();
  return <>{onMonth(searchParams.get("month"))}</>;
}

/**
 * A Sidebar é o único elemento estrutural fixo da plataforma (Decisão 012 —
 * a Top Bar global foi removida): superfície off-white quente permanente
 * (Etapa "Sidebar Off-White + Grafite + Areia Assinatura — v4" — não
 * acompanha o tema claro/escuro do resto da aplicação, por isso as cores
 * aqui usam os tokens fixos `sidebar-*` — ver bloco dedicado em
 * `globals.css` — em vez dos tokens de tema `foreground`/`border`/`card`,
 * que trocam de valor no dark mode). 3 rodadas anteriores já tentaram
 * carregar a identidade através da SUPERFÍCIE (areia clara, grafite quente,
 * taupe médio) — todas ou perderam legibilidade ou viraram uma massa
 * vertical de cor grande demais, competindo com o conteúdo. Esta inverte a
 * hipótese: a Sidebar fica quase na mesma família clara do conteúdo
 * (separada só por um `border-right` sutil, não por contraste de fundo),
 * texto/ícone voltam a grafite, e areia (`--sand`, direto) vira
 * estritamente assinatura PONTUAL — rail do ativo, focus ring, indicador de
 * drop-target, hover do "+" — nunca mais uma superfície. Grafite entra
 * também como o bloco sólido do item ativo, agora o elemento de maior
 * contraste da tela por uma margem ainda maior (bloco escuro sobre
 * superfície clara). A Sidebar
 * ocupa exatamente 100% da altura da viewport em qualquer breakpoint
 * (`SIDEBAR_HEIGHT_CLASS`) e é o principal elemento de navegação da
 * plataforma. No mobile ela continua sendo um drawer (abrir tudo o tempo
 * todo tomaria a área operacional inteira — Cap. 17 dos Princípios de
 * Arquitetura); como não existe mais Top Bar cujo botão "Menu" a acionava,
 * o próprio componente expõe um gatilho flutuante (`onOpen`) — só visível
 * no mobile e só quando o drawer está fechado.
 */
export function Sidebar({
  profile,
  mobileOpen,
  onOpen,
  onClose,
}: {
  profile: { name: string; role: UserRole };
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
          className="mitza-pressable fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-surface text-sidebar-foreground shadow-[var(--shadow-float)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sand md:hidden"
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
            <SidebarContent profile={profile} pathname={pathname} month={null} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
          }
        >
          <SidebarMonthParam
            onMonth={(month) => (
              <SidebarContent profile={profile} pathname={pathname} month={month} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
            )}
          />
        </Suspense>
      </aside>
    </>
  );
}
