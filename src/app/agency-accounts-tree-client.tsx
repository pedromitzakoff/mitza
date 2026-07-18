"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder } from "lucide-react";
import { moveClientInTree, type AgencyTree } from "@/lib/agency-accounts-tree";
import { useToast } from "@/app/toast-provider";
import {
  getOpenTaskCountForManagerAction,
  transferClientManagerAction,
  type ClientTransferMode,
} from "./agency-accounts-tree-actions";
import { AgencyTransferDialog } from "./agency-accounts-tree-transfer-dialog";

const UNASSIGNED_KEY = "__unassigned__";
/** Tempo de hover sobre uma pasta recolhida, arrastando um cliente por
 * cima, até ela se abrir sozinha (item 3 do pedido). Curto o bastante pra
 * não parecer travado, longo o bastante pra não abrir sozinha ao só
 * passar por cima de passagem. */
const HOVER_EXPAND_DELAY_MS = 600;

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

function findClientName(tree: AgencyTree, clientId: string): string | null {
  for (const manager of tree.managers) {
    const match = manager.clients.find((client) => client.id === clientId);
    if (match) return match.name;
  }
  return tree.unassigned.find((client) => client.id === clientId)?.name ?? null;
}

/** "Sem responsável" pro bucket especial, nome do gestor pros demais —
 * usado tanto pro rótulo do destino quanto pro nome do gestor anterior no
 * diálogo de confirmação. */
function labelForKey(tree: AgencyTree, key: string): string {
  if (key === UNASSIGNED_KEY) return "Sem responsável";
  return tree.managers.find((manager) => manager.id === key)?.name ?? "";
}

function ClientLeaf({
  id,
  name,
  isActive,
  isAdmin,
  isDragging,
  isBusy,
  onDragStart,
  onDragEnd,
}: {
  id: string;
  name: string;
  isActive: boolean;
  isAdmin: boolean;
  isDragging: boolean;
  isBusy: boolean;
  onDragStart: (clientId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <li>
      <Link
        href={`/clients/${id}`}
        title={name}
        draggable={isAdmin && !isBusy}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart(id);
        }}
        onDragEnd={onDragEnd}
        className={`flex items-center justify-between gap-2 rounded-md py-1 pl-7 pr-2 text-[13px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          isActive ? "bg-brand/15 font-semibold text-brand" : "font-normal text-zinc-300 hover:bg-white/10"
        } ${isDragging ? "opacity-40" : ""}`}
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
  folderKey,
  name,
  clients,
  isExpanded,
  onToggle,
  activeClientId,
  isAdmin,
  isBusy,
  isDropTarget,
  draggingClientId,
  onDragEnterFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onDragStartClient,
  onDragEndClient,
}: {
  folderKey: string;
  name: string;
  clients: { id: string; name: string }[];
  isExpanded: boolean;
  onToggle: () => void;
  activeClientId: string | null;
  isAdmin: boolean;
  isBusy: boolean;
  isDropTarget: boolean;
  draggingClientId: string | null;
  onDragEnterFolder: (key: string) => void;
  onDragLeaveFolder: (key: string) => void;
  onDropOnFolder: () => void;
  onDragStartClient: (clientId: string) => void;
  onDragEndClient: () => void;
}) {
  return (
    <li
      onDragOver={(event) => {
        if (!isAdmin || isBusy) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragEnterFolder(folderKey);
      }}
      onDragLeave={(event) => {
        if (!isAdmin) return;
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        onDragLeaveFolder(folderKey);
      }}
      onDrop={(event) => {
        if (!isAdmin || isBusy) return;
        event.preventDefault();
        onDropOnFolder();
      }}
      className={`rounded-md ${isDropTarget ? "bg-brand/10 ring-1 ring-inset ring-brand/40" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        title={name}
        className="mitza-pressable flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium text-zinc-200 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
              <ClientLeaf
                key={client.id}
                id={client.id}
                name={client.name}
                isActive={client.id === activeClientId}
                isAdmin={isAdmin}
                isBusy={isBusy}
                isDragging={draggingClientId === client.id}
                onDragStart={onDragStartClient}
                onDragEnd={onDragEndClient}
              />
            ))
          ) : (
            <li className="py-1 pl-7 pr-2 text-xs text-zinc-500">Nenhum cliente</li>
          )}
        </ul>
      )}
    </li>
  );
}

interface PendingTransfer {
  clientId: string;
  clientName: string;
  previousManagerId: string | null;
  previousManagerName: string | null;
  targetKey: string;
  targetManagerId: string | null;
  targetLabel: string;
  openTaskCount: number;
}

/**
 * "Contas da Agência" — árvore de navegação (não de permissão): qualquer
 * gestor abre qualquer conta, independente de quem é o responsável
 * principal. Cada pasta (gestor) tem estado independente de expansão; a
 * carteira do próprio usuário e a do cliente atualmente aberto começam
 * expandidas, e nenhuma pasta que o usuário já abriu na sessão é fechada
 * automaticamente — só entram novos ids no conjunto, nunca saem.
 *
 * Admin pode arrastar um cliente pra outra pasta pra transferir
 * `clients.primary_manager_id` (Etapa "Drag and drop de Contas da
 * Agência") — gestor comum continua navegando normalmente, só não inicia
 * o arraste (a Server Action também exige admin, isto é só a UI não
 * sugerir uma interação que falharia).
 */
export function AgencyAccountsTreeView({
  tree,
  currentManagerId,
  isAdmin,
}: {
  tree: AgencyTree;
  currentManagerId: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const activeClientId = activeClientIdFromPathname(pathname);
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

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

  // Estado otimista da transferência: aplicado sobre a árvore vinda do
  // servidor assim que o usuário confirma (não ao soltar — a confirmação
  // é obrigatória antes de qualquer mudança visual real), pra a
  // movimentação parecer instantânea. Em caso de erro, a entrada é
  // removida e o cliente volta a aparecer na pasta original, porque
  // `effectiveTree` cai de volta a computar só a partir de `tree` (que
  // nunca mudou de verdade nesse caso).
  const [optimisticMoves, setOptimisticMoves] = useState<Map<string, string | null>>(new Map());
  const effectiveTree = useMemo(() => {
    let result = tree;
    for (const [clientId, targetManagerId] of optimisticMoves) {
      result = moveClientInTree(result, clientId, targetManagerId);
    }
    return result;
  }, [tree, optimisticMoves]);

  const [draggingClientId, setDraggingClientId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverKeyRef = useRef<string | null>(null);

  function clearHoverExpand() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    hoverKeyRef.current = null;
  }

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
    const key = activeClientId ? keyForClient(effectiveTree, activeClientId) : null;
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

  function handleDragStartClient(clientId: string) {
    setDraggingClientId(clientId);
  }

  function handleDragEndClient() {
    setDraggingClientId(null);
    setDragOverKey(null);
    clearHoverExpand();
  }

  function handleDragEnterFolder(key: string) {
    setDragOverKey((prev) => (prev === key ? prev : key));
    if (hoverKeyRef.current === key) return;
    clearHoverExpand();
    hoverKeyRef.current = key;
    hoverTimerRef.current = setTimeout(() => {
      setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }, HOVER_EXPAND_DELAY_MS);
  }

  function handleDragLeaveFolder(key: string) {
    // Só reage se a pasta que está saindo ainda é a destacada — evita que
    // uma saída "atrasada" de A apague o realce de B quando o arraste já
    // entrou em B antes do evento de saída de A chegar.
    setDragOverKey((prev) => (prev === key ? null : prev));
    if (hoverKeyRef.current === key) clearHoverExpand();
  }

  function handleDropOnFolder(targetKey: string, targetManagerId: string | null) {
    clearHoverExpand();
    setDragOverKey(null);
    const clientId = draggingClientId;
    setDraggingClientId(null);
    if (!clientId || isPending || pendingTransfer) return;

    const sourceKey = keyForClient(effectiveTree, clientId);
    if (!sourceKey || sourceKey === targetKey) return;

    const clientName = findClientName(effectiveTree, clientId);
    if (!clientName) return;

    const previousManagerId = sourceKey === UNASSIGNED_KEY ? null : sourceKey;
    const previousManagerName = sourceKey === UNASSIGNED_KEY ? null : labelForKey(effectiveTree, sourceKey);
    const targetLabel = labelForKey(effectiveTree, targetKey);

    if (!previousManagerId) {
      setPendingTransfer({
        clientId,
        clientName,
        previousManagerId: null,
        previousManagerName: null,
        targetKey,
        targetManagerId,
        targetLabel,
        openTaskCount: 0,
      });
      return;
    }

    startTransition(async () => {
      const result = await getOpenTaskCountForManagerAction(clientId, previousManagerId);
      if ("error" in result) {
        showToast(result.error, "error");
        return;
      }
      setPendingTransfer({
        clientId,
        clientName,
        previousManagerId,
        previousManagerName,
        targetKey,
        targetManagerId,
        targetLabel,
        openTaskCount: result.count,
      });
    });
  }

  function handleCancelTransfer() {
    if (isPending) return;
    setPendingTransfer(null);
  }

  function handleConfirmTransfer(mode: ClientTransferMode) {
    if (!pendingTransfer) return;
    const { clientId, previousManagerId, targetManagerId, targetKey, clientName, targetLabel } = pendingTransfer;

    setOptimisticMoves((prev) => new Map(prev).set(clientId, targetManagerId));
    setExpanded((prev) => (prev.has(targetKey) ? prev : new Set(prev).add(targetKey)));

    startTransition(async () => {
      const result = await transferClientManagerAction(clientId, previousManagerId, targetManagerId, mode);
      if (result.error) {
        setOptimisticMoves((prev) => {
          const next = new Map(prev);
          next.delete(clientId);
          return next;
        });
        showToast(result.error, "error");
        setPendingTransfer(null);
        return;
      }
      showToast(`${clientName} transferido para ${targetLabel}.`);
      setOptimisticMoves((prev) => {
        const next = new Map(prev);
        next.delete(clientId);
        return next;
      });
      setPendingTransfer(null);
    });
  }

  if (effectiveTree.managers.length === 0 && effectiveTree.unassigned.length === 0) return null;

  return (
    <div className="mt-2 flex min-h-0 flex-col px-2.5">
      <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Contas da Agência
      </p>
      <ul className="flex flex-col gap-0.5">
        {effectiveTree.managers.map((manager) => (
          <ManagerFolder
            key={manager.id}
            folderKey={manager.id}
            name={manager.name}
            clients={manager.clients}
            isExpanded={expanded.has(manager.id)}
            onToggle={() => toggle(manager.id)}
            activeClientId={activeClientId}
            isAdmin={isAdmin}
            isBusy={isPending || pendingTransfer !== null}
            isDropTarget={dragOverKey === manager.id}
            draggingClientId={draggingClientId}
            onDragEnterFolder={handleDragEnterFolder}
            onDragLeaveFolder={handleDragLeaveFolder}
            onDropOnFolder={() => handleDropOnFolder(manager.id, manager.id)}
            onDragStartClient={handleDragStartClient}
            onDragEndClient={handleDragEndClient}
          />
        ))}
        {effectiveTree.unassigned.length > 0 && (
          <ManagerFolder
            key={UNASSIGNED_KEY}
            folderKey={UNASSIGNED_KEY}
            name="Sem responsável"
            clients={effectiveTree.unassigned}
            isExpanded={expanded.has(UNASSIGNED_KEY)}
            onToggle={() => toggle(UNASSIGNED_KEY)}
            activeClientId={activeClientId}
            isAdmin={isAdmin}
            isBusy={isPending || pendingTransfer !== null}
            isDropTarget={dragOverKey === UNASSIGNED_KEY}
            draggingClientId={draggingClientId}
            onDragEnterFolder={handleDragEnterFolder}
            onDragLeaveFolder={handleDragLeaveFolder}
            onDropOnFolder={() => handleDropOnFolder(UNASSIGNED_KEY, null)}
            onDragStartClient={handleDragStartClient}
            onDragEndClient={handleDragEndClient}
          />
        )}
      </ul>

      {pendingTransfer && (
        <AgencyTransferDialog
          clientName={pendingTransfer.clientName}
          targetLabel={pendingTransfer.targetLabel}
          previousManagerName={pendingTransfer.previousManagerName}
          openTaskCount={pendingTransfer.openTaskCount}
          pending={isPending}
          onCancel={handleCancelTransfer}
          onConfirm={handleConfirmTransfer}
        />
      )}
    </div>
  );
}
