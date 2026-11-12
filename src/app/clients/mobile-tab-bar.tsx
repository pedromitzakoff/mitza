"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildClientNavItems } from "@/app/sidebar";

/**
 * Etapa "Otimizacao mobile - Fase 2" (pedido explicito do usuario: barra
 * inferior com Dashboard/Campanhas/Anuncios/Metas). Reaproveita 100%
 * `buildClientNavItems` (MESMA funcao/ordem/hrefs/`isActive` que ja
 * alimenta o menu do cliente na Sidebar) - nenhuma segunda lista de
 * navegacao. Troca de cliente e rotas administrativas continuam fora
 * daqui, acessiveis pelo botao flutuante de abrir a Sidebar (que ja leva
 * ao `ClientSwitcher` e ao grupo "Gestao") - esta barra e so um atalho
 * pros 4 destinos do dia a dia, nunca uma segunda navegacao.
 */
function MobileTabBarItems({ clientId, month, pathname }: { clientId: string; month: string | null; pathname: string }) {
  const items = buildClientNavItems(clientId, month);
  return (
    <>
      {items.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              active ? "text-brand" : "text-overview-text-muted"
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Le `?month=` via `useSearchParams()` (precisa de `Suspense`) - mesmo
 * padrao ja usado por `SidebarMonthParam` em `sidebar.tsx`, nunca uma
 * segunda forma de ler o mes selecionado. */
function MobileTabBarMonthParam({ clientId, pathname }: { clientId: string; pathname: string }) {
  const searchParams = useSearchParams();
  return <MobileTabBarItems clientId={clientId} month={searchParams.get("month")} pathname={pathname} />;
}

export function MobileTabBar({ clientId }: { clientId: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação do cliente"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-overview-border bg-overview-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Suspense fallback={null}>
        <MobileTabBarMonthParam clientId={clientId} pathname={pathname} />
      </Suspense>
    </nav>
  );
}
