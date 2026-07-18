"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder } from "lucide-react";
import type { AgencyTree } from "@/lib/agency-accounts-tree";

const UNASSIGNED_KEY = "__unassigned__";

/** Extrai o id do cliente da própria rota (`/clients/<id>`, incluindo
 * subrotas como `/clients/<id>/edit`) — mesmo mecanismo que `NAV_ITEMS` já
 * usa pra destacar Sprints/Equipe (`isActive(pathname)`), só que aqui o
 * "item" é dinâmico. `/clients/new` não é um cliente de verdade. */
function activeClientIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  if (!match) return null;
  return match[1] === "new" ? null : match[1];
}

function keyForClient(tree: AgencyTree, clientId: string): string | null {
  for (const manager of tree.managers) {
    if (manager.clients.some((client) => client.id === clientId)) return manager.id;
  }
  if (tree.unassigned.some((client) => client.id === clientId)) return UNASSIGNED_KEY;
  return null;
}

function ClientLeaf({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  return (
    <li>
      <Link
        href={`/clients/${id}`}
        title={name}
        className={`flex items-center justify-between gap-2 rounded-md py-1 pl-7 pr-2 text-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isActive ? "bg-brand/15 font-semibold text-brand" : "font-normal text-zinc-300 hover:bg-white/10"
        }`}
      >
        {/* Slot reservado pra informação futura ao lado do cliente (status,
            pendências, revisão etc.) — nada renderiza aqui ainda. Manter o
            `justify-between` já prepara o espaço sem precisar redesenhar a
            linha quando esse dia chegar. */}
        <span className="min-w-0 truncate">{name}</span>
      </Link>
    </li>
  );
}

function ManagerFolder({
  name,
  clients,
  isExpanded,
  onToggle,
  activeClientId,
}: {
  name: string;
  clients: { id: string; name: string }[];
  isExpanded: boolean;
  onToggle: () => void;
  activeClientId: string | null;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        title={name}
        className="mitza-pressable flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-200 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span
          className={`mitza-chevron shrink-0 text-xs text-zinc-500 ${isExpanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <Folder className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        {!isExpanded && clients.length > 0 && (
          <span className="shrink-0 text-xs text-zinc-500">{clients.length}</span>
        )}
      </button>

      {isExpanded && (
        <ul className="flex flex-col gap-0.5">
          {clients.length > 0 ? (
            clients.map((client) => (
              <ClientLeaf key={client.id} id={client.id} name={client.name} isActive={client.id === activeClientId} />
            ))
          ) : (
            <li className="py-1 pl-7 pr-2 text-xs text-zinc-500">Nenhum cliente</li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * "Contas da Agência" — árvore de navegação (não de permissão): qualquer
 * gestor abre qualquer conta, independente de quem é o responsável
 * principal. Cada pasta (gestor) tem estado independente de expansão; a
 * carteira do próprio usuário e a do cliente atualmente aberto começam
 * expandidas, e nenhuma pasta que o usuário já abriu na sessão é fechada
 * automaticamente — só entram novos ids no conjunto, nunca saem.
 */
export function AgencyAccountsTreeView({
  tree,
  currentManagerId,
}: {
  tree: AgencyTree;
  currentManagerId: string;
}) {
  const pathname = usePathname();
  const activeClientId = activeClientIdFromPathname(pathname);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (tree.managers.some((manager) => manager.id === currentManagerId)) {
      initial.add(currentManagerId);
    }
    if (activeClientId) {
      const key = keyForClient(tree, activeClientId);
      if (key) initial.add(key);
    }
    return initial;
  });

  // Navegar pra um cliente de uma carteira ainda fechada deve revelá-la —
  // sem isso, "o cliente atualmente aberto" (Objetivo do recurso) deixaria
  // de valer ao trocar de cliente via link direto/busca. O guard compara
  // contra o ÚLTIMO cliente ativo visto (não contra `expanded.has(key)`
  // diretamente): se comparasse contra o Set, fechar manualmente a
  // carteira do cliente ativo reabriria sozinha no próximo render — o
  // usuário nunca conseguiria recolher a própria carteira aberta. Só a
  // TROCA pra um cliente novo dispara a expansão. Estado (não ref) por
  // exigência do React: ler/mutar ref durante o render não é seguro.
  const [lastActiveClientId, setLastActiveClientId] = useState(activeClientId);
  if (activeClientId !== lastActiveClientId) {
    setLastActiveClientId(activeClientId);
    const key = activeClientId ? keyForClient(tree, activeClientId) : null;
    if (key) {
      setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (tree.managers.length === 0 && tree.unassigned.length === 0) return null;

  return (
    <div className="mt-3 flex min-h-0 flex-col px-2.5">
      <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Contas da Agência
      </p>
      <ul className="flex flex-col gap-0.5">
        {tree.managers.map((manager) => (
          <ManagerFolder
            key={manager.id}
            name={manager.name}
            clients={manager.clients}
            isExpanded={expanded.has(manager.id)}
            onToggle={() => toggle(manager.id)}
            activeClientId={activeClientId}
          />
        ))}
        {tree.unassigned.length > 0 && (
          <ManagerFolder
            key={UNASSIGNED_KEY}
            name="Sem responsável"
            clients={tree.unassigned}
            isExpanded={expanded.has(UNASSIGNED_KEY)}
            onToggle={() => toggle(UNASSIGNED_KEY)}
            activeClientId={activeClientId}
          />
        )}
      </ul>
    </div>
  );
}
