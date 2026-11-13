import type { ReactNode } from "react";

/**
 * "Configurações do Cliente" (ponto 8 do pedido): "Excluir cliente" sai do
 * fluxo principal da tela e vai pra um menu secundário, só pra usuário
 * autorizado (admin — a mesma checagem de sempre, `isAdmin` lido pelo
 * chamador). Mesmo padrão de menu "•••" já usado em Configurações → Equipe
 * (`team-table.tsx`) — `<details>`/`<summary>` nativo, sem estado de React
 * nenhum, nunca uma segunda implementação de dropdown.
 */
export function AdminActionsMenu({ children }: { children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="mitza-pressable flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
        •••
      </summary>
      <div className="mitza-menu-in absolute right-0 z-10 mt-1 flex w-56 flex-col gap-0.5 rounded-md border border-overview-border bg-overview-surface p-1 shadow-[var(--shadow-float)]">
        <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">Administração</p>
        {children}
      </div>
    </details>
  );
}
