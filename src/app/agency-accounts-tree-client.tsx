"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Folder, Plus, Search } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type AgencyTree, type AgencyTreeClient } from "@/lib/agency-accounts-tree";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/app/toast-provider";
import { getOpenTaskCountForManagerAction, moveClientAction, type ClientTransferMode } from "./agency-accounts-tree-actions";
import { AgencyTransferDialog } from "./agency-accounts-tree-transfer-dialog";

const UNASSIGNED_KEY = "__unassigned__";
/** Tempo de hover sobre uma pasta recolhida, arrastando um cliente por
 * cima, até ela se abrir sozinha. Curto o bastante pra não parecer
 * travado, longo o bastante pra não abrir sozinha ao só passar por cima de
 * passagem. */
const HOVER_EXPAND_DELAY_MS = 600;

const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

/** Extrai o id do cliente da própria rota (`/clients/<id>`, incluindo
 * subrotas como `/clients/<id>/edit`) — mesmo mecanismo que `NAV_ITEMS` já
 * usa pra destacar Sprints/Equipe (`isActive(pathname)`), só que aqui o
 * "item" é dinâmico. `/clients/new` não é um cliente de verdade. */
function activeClientIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  if (!match) return null;
  return match[1] === "new" ? null : match[1];
}

type Containers = Record<string, AgencyTreeClient[]>;

function buildContainers(tree: AgencyTree): Containers {
  const result: Containers = { [UNASSIGNED_KEY]: [...tree.unassigned] };
  for (const manager of tree.managers) result[manager.id] = [...manager.clients];
  return result;
}

/** Container (pasta) que contém o id informado — o próprio id de uma
 * pasta conta como match (soltar sobre a área da pasta, não sobre um
 * cliente específico: pasta vazia ou ainda recolhida). */
function findContainerKey(containers: Containers, id: string): string | null {
  if (id in containers) return id;
  for (const key of Object.keys(containers)) {
    if (containers[key].some((client) => client.id === id)) return key;
  }
  return null;
}

/** Normaliza acento/caixa pra busca — "judclass" encontra "JudClass",
 * "sao" encontra "São". */
function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

interface PendingTransfer {
  clientId: string;
  clientName: string;
  previousManagerId: string | null;
  previousManagerName: string | null;
  targetKey: string;
  targetManagerId: string | null;
  targetLabel: string;
  previousSiblingId: string | null;
  nextSiblingId: string | null;
  openTaskCount: number;
  /** Arranjo completo (todos os containers) já refletindo a movimentação —
   * aplicado de volta ao estado só quando o usuário confirma. Até lá, a
   * árvore visível volta pro snapshot anterior ao drag: a confirmação é
   * obrigatória antes de qualquer mudança visual real. */
  optimisticContainers: Containers;
}

function ClientLeaf({
  client,
  isActive,
  isSearchMatch,
  disabled,
}: {
  client: AgencyTreeClient;
  isActive: boolean;
  isSearchMatch: boolean;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: client.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <Link
        href={`/clients/${client.id}`}
        title={client.name}
        {...attributes}
        {...listeners}
        className={`flex items-center gap-1.5 rounded-md py-1 pl-7 pr-2 text-[13px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          disabled ? "" : "cursor-grab touch-none active:cursor-grabbing"
        } ${
          // Etapa "Sidebar Areia — Identidade KOFF": ativo vira o mesmo
          // bloco grafite sólido + off-white da nav principal (sem barra
          // lateral aqui — item aninhado, a barra é reservada pros 4
          // destinos de topo). Combinação em busca não pode mais usar
          // areia (a própria superfície agora) nem o mesmo tom do ativo —
          // vira um contorno grafite sutil (`ring` + fundo bem fraco),
          // reconhecível como "achei isto" sem ser confundido com "estou
          // nesta página".
          isActive
            ? "bg-sidebar-active-surface font-semibold text-sidebar-active-foreground"
            : isSearchMatch
              ? "bg-sidebar-match-surface font-medium text-sidebar-foreground ring-1 ring-inset ring-sidebar-match-ring"
              : "font-normal text-sidebar-foreground-secondary hover:bg-sidebar-hover hover:text-sidebar-foreground"
        } ${isDragging ? "opacity-30" : ""}`}
      >
        <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="xs" />
        <span className="min-w-0 truncate">{client.name}</span>
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
  searchMatchIds,
  dragDisabled,
  isDropTarget,
  isDimmed,
}: {
  folderKey: string;
  name: string;
  clients: AgencyTreeClient[];
  isExpanded: boolean;
  onToggle: () => void;
  activeClientId: string | null;
  searchMatchIds: Set<string>;
  dragDisabled: boolean;
  isDropTarget: boolean;
  isDimmed: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: folderKey });

  return (
    <li
      ref={setNodeRef}
      className={`rounded-md transition-[opacity,background-color] duration-[var(--motion-fast)] ease-[var(--ease-enter)] ${
        // Etapa "Sidebar Areia — Identidade KOFF": o alvo de "soltar" ao
        // arrastar é um destaque temporário, não uma seleção — mesmo
        // contorno grafite sutil usado em busca (nunca a superfície areia
        // sobre ela mesma, nem o bloco sólido do ativo).
        isDropTarget ? "bg-sidebar-match-surface ring-1 ring-inset ring-sidebar-match-ring" : ""
      } ${isDimmed ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        title={name}
        className="mitza-pressable flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium text-sidebar-foreground-secondary transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span
          className={`mitza-chevron shrink-0 text-xs ${isDropTarget ? "text-sidebar-foreground" : "text-sidebar-foreground-muted"} ${isExpanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <Folder className={`h-4 w-4 shrink-0 ${isDropTarget ? "text-sidebar-foreground" : "text-sidebar-foreground-muted"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        {!isExpanded && clients.length > 0 && (
          <span className={`shrink-0 text-xs ${isDropTarget ? "text-sidebar-foreground" : "text-sidebar-foreground-muted"}`}>{clients.length}</span>
        )}
      </button>

      {isExpanded && (
        <SortableContext items={clients.map((client) => client.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {clients.length > 0 ? (
              clients.map((client) => (
                <ClientLeaf
                  key={client.id}
                  client={client}
                  isActive={client.id === activeClientId}
                  isSearchMatch={searchMatchIds.has(client.id)}
                  disabled={dragDisabled}
                />
              ))
            ) : (
              <li className="py-1 pl-7 pr-2 text-xs text-sidebar-foreground-subtle">Nenhum cliente</li>
            )}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}

/**
 * "Contas da Agência" — árvore de navegação (não de permissão): qualquer
 * gestor abre qualquer conta, independente de quem é o responsável
 * principal. Cada pasta (gestor) tem estado independente de expansão;
 * todas começam fechadas quando a aplicação é aberta — só expandem por
 * clique explícito na pasta (ou pelo hover ao arrastar um cliente por
 * cima, ver `HOVER_EXPAND_DELAY_MS`). Nenhuma pasta que o usuário já abriu
 * na sessão é fechada automaticamente — só entram novos ids no conjunto,
 * nunca saem. Localizar um cliente sem abrir pasta por pasta é papel da
 * busca (abaixo), não de auto-expansão (Etapa "Fila de Prioridades 1.0").
 *
 * Etapa "Árvore Viva 1.0": substitui a busca antiga por um campo no topo
 * que encontra cliente OU gestor em qualquer pasta (item aprovado:
 * "busca deve filtrar a árvore inteira"), com expansão temporária das
 * pastas relevantes — nunca escreve em `expanded`, então limpar a busca
 * restaura exatamente o estado anterior. Qualquer usuário ativo (admin ou
 * gestor — Etapa "Habilitar Gestores 2.0") pode arrastar um cliente
 * (`@dnd-kit`) pra reordenar dentro da mesma pasta (persistido em
 * `clients.wallet_position`, sem diálogo) ou pra outra pasta (troca de
 * `primary_manager_id`, com a mesma confirmação de transferência de
 * atividades já validada antes) — ambos os fluxos passam por
 * `moveClientAction`, o único ponto de entrada de movimentação de
 * cliente. Busca ativa desabilita o arraste (a lista filtrada não é uma
 * ordem estável pra reordenar contra).
 */
export function AgencyAccountsTreeView({
  tree,
  isAdmin,
}: {
  tree: AgencyTree;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activeClientId = activeClientIdFromPathname(pathname);
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [containers, setContainers] = useState<Containers>(() => buildContainers(tree));
  const [lastSyncedTree, setLastSyncedTree] = useState(tree);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);

  // Ressincroniza com a árvore vinda do servidor quando ela mudar de
  // verdade (revalidatePath após qualquer movimentação) — nunca durante um
  // drag em curso, senão uma revalidação de outra origem apagaria o
  // deslocamento visual em andamento. Mesmo padrão de "ajustar estado
  // durante o render ao mudar uma prop" já usado logo abaixo pra
  // `lastActiveClientId` (estado, não ref — refs não podem ser lidas
  // durante o render).
  if (tree !== lastSyncedTree && activeId === null && !pendingTransfer) {
    setLastSyncedTree(tree);
    setContainers(buildContainers(tree));
  }

  const snapshotRef = useRef<Containers>(containers);
  const dragStartContainerRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBusy = isPending || pendingTransfer !== null;

  const managerNameByKey = useMemo(() => {
    const map = new Map<string, string>([[UNASSIGNED_KEY, "Sem responsável"]]);
    for (const manager of tree.managers) map.set(manager.id, manager.name);
    return map;
  }, [tree]);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const manager of tree.managers) for (const client of manager.clients) map.set(client.id, client.name);
    for (const client of tree.unassigned) map.set(client.id, client.name);
    return map;
  }, [tree]);

  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = normalizeSearch(searchQuery);
  const searchActive = normalizedQuery.length > 0;

  const searchMatchIds = useMemo(() => {
    if (!searchActive) return new Set<string>();
    const ids = new Set<string>();
    for (const key of Object.keys(containers)) {
      for (const client of containers[key]) {
        if (normalizeSearch(client.name).includes(normalizedQuery)) ids.add(client.id);
      }
    }
    return ids;
  }, [containers, normalizedQuery, searchActive]);

  // Expansão temporária: derivada da busca, nunca escrita em `expanded` —
  // limpar o campo faz `searchExpandedKeys` voltar a `null` e a árvore
  // volta a ler `expanded` puro, exatamente como estava antes de buscar.
  const searchExpandedKeys = useMemo(() => {
    if (!searchActive) return null;
    const keys = new Set<string>();
    for (const key of Object.keys(containers)) {
      const managerMatches = key !== UNASSIGNED_KEY && normalizeSearch(managerNameByKey.get(key) ?? "").includes(normalizedQuery);
      const hasMatchingClient = containers[key].some((client) => searchMatchIds.has(client.id));
      if (managerMatches || hasMatchingClient) keys.add(key);
    }
    return keys;
  }, [searchActive, containers, managerNameByKey, normalizedQuery, searchMatchIds]);

  function isExpanded(key: string): boolean {
    return searchExpandedKeys ? searchExpandedKeys.has(key) : expanded.has(key);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearHoverExpand() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }

  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    snapshotRef.current = containers;
    dragStartContainerRef.current = findContainerKey(containers, id);
    setActiveId(id);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId2 = active.id as string;
    const overId = over.id as string;
    const activeContainer = findContainerKey(containers, activeId2);
    const overContainer = findContainerKey(containers, overId);
    if (!activeContainer || !overContainer) return;

    if (overContainer !== dragOverFolderKey) {
      setDragOverFolderKey(overContainer);
      clearHoverExpand();
      hoverTimerRef.current = setTimeout(() => {
        setExpanded((prev) => (prev.has(overContainer) ? prev : new Set(prev).add(overContainer)));
      }, HOVER_EXPAND_DELAY_MS);
    }

    if (activeContainer === overContainer) return;

    setContainers((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((client) => client.id === activeId2);
      if (activeIndex === -1) return prev;
      const overIndex = overItems.findIndex((client) => client.id === overId);
      const insertIndex = overIndex >= 0 ? overIndex : overItems.length;
      const movingClient = activeItems[activeIndex];
      return {
        ...prev,
        [activeContainer]: activeItems.filter((client) => client.id !== activeId2),
        [overContainer]: [...overItems.slice(0, insertIndex), movingClient, ...overItems.slice(insertIndex)],
      };
    });
  }

  function resetDragUi() {
    setActiveId(null);
    setDragOverFolderKey(null);
    clearHoverExpand();
    dragStartContainerRef.current = null;
  }

  function handleDragCancel() {
    setContainers(snapshotRef.current);
    resetDragUi();
  }

  function commitSameFolderReorder(
    clientId: string,
    targetManagerId: string | null,
    previousSiblingId: string | null,
    nextSiblingId: string | null,
  ) {
    startTransition(async () => {
      const result = await moveClientAction(clientId, targetManagerId, targetManagerId, previousSiblingId, nextSiblingId);
      if (result.error) {
        setContainers(snapshotRef.current);
        showToast(result.error, "error");
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const startContainer = dragStartContainerRef.current;
    resetDragUi();

    if (!over || !startContainer) {
      setContainers(snapshotRef.current);
      return;
    }

    const clientId = active.id as string;
    const overId = over.id as string;
    const endContainer = findContainerKey(containers, clientId);
    if (!endContainer) {
      setContainers(snapshotRef.current);
      return;
    }

    if (startContainer === endContainer) {
      const items = containers[endContainer];
      const oldIndex = items.findIndex((client) => client.id === clientId);
      const overIndex = items.findIndex((client) => client.id === overId);
      const newIndex = overIndex >= 0 ? overIndex : items.length - 1;
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = [...items];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      setContainers((prev) => ({ ...prev, [endContainer]: reordered }));

      const finalIndex = reordered.findIndex((client) => client.id === clientId);
      const previousSibling = finalIndex > 0 ? reordered[finalIndex - 1] : null;
      const nextSibling = finalIndex < reordered.length - 1 ? reordered[finalIndex + 1] : null;
      const targetManagerId = endContainer === UNASSIGNED_KEY ? null : endContainer;

      commitSameFolderReorder(clientId, targetManagerId, previousSibling?.id ?? null, nextSibling?.id ?? null);
      return;
    }

    // Movimentação entre pastas: `containers` já reflete o deslocamento ao
    // vivo do onDragOver. Guarda esse arranjo pra reaplicar só se
    // confirmado, e volta a árvore visível pro snapshot até lá.
    const finalItems = containers[endContainer];
    const finalIndex = finalItems.findIndex((client) => client.id === clientId);
    if (finalIndex === -1) {
      setContainers(snapshotRef.current);
      return;
    }

    const previousSibling = finalIndex > 0 ? finalItems[finalIndex - 1] : null;
    const nextSibling = finalIndex < finalItems.length - 1 ? finalItems[finalIndex + 1] : null;
    const clientName = finalItems[finalIndex].name;
    const optimisticContainers = containers;

    setContainers(snapshotRef.current);

    const previousManagerId = startContainer === UNASSIGNED_KEY ? null : startContainer;
    const targetManagerId = endContainer === UNASSIGNED_KEY ? null : endContainer;
    const targetLabel = managerNameByKey.get(endContainer) ?? "";

    if (!previousManagerId) {
      setPendingTransfer({
        clientId,
        clientName,
        previousManagerId: null,
        previousManagerName: null,
        targetKey: endContainer,
        targetManagerId,
        targetLabel,
        previousSiblingId: previousSibling?.id ?? null,
        nextSiblingId: nextSibling?.id ?? null,
        openTaskCount: 0,
        optimisticContainers,
      });
      return;
    }

    const previousManagerName = managerNameByKey.get(startContainer) ?? "";
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
        targetKey: endContainer,
        targetManagerId,
        targetLabel,
        previousSiblingId: previousSibling?.id ?? null,
        nextSiblingId: nextSibling?.id ?? null,
        openTaskCount: result.count,
        optimisticContainers,
      });
    });
  }

  function handleCancelTransfer() {
    if (isPending) return;
    setPendingTransfer(null);
  }

  function handleConfirmTransfer(mode: ClientTransferMode) {
    if (!pendingTransfer) return;
    const {
      clientId,
      previousManagerId,
      targetManagerId,
      targetKey,
      clientName,
      targetLabel,
      previousSiblingId,
      nextSiblingId,
      optimisticContainers,
    } = pendingTransfer;

    setContainers(optimisticContainers);
    setExpanded((prev) => (prev.has(targetKey) ? prev : new Set(prev).add(targetKey)));

    startTransition(async () => {
      const result = await moveClientAction(clientId, previousManagerId, targetManagerId, previousSiblingId, nextSiblingId, mode);
      if (result.error) {
        setContainers(snapshotRef.current);
        showToast(result.error, "error");
        setPendingTransfer(null);
        return;
      }
      showToast(`${clientName} transferido para ${targetLabel}.`);
      setPendingTransfer(null);
    });
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    if (searchMatchIds.size === 1) {
      const [onlyId] = searchMatchIds;
      router.push(`/clients/${onlyId}`);
    }
  }

  // Habilitar Gestores 2.0: arrastar clientes entre pastas deixou de ser
  // admin-only — qualquer gestor ativo pode, igual ao admin (ver
  // moveClientAction/getOpenTaskCountForManagerAction em
  // agency-accounts-tree-actions.ts).
  const dragDisabled = isBusy || searchActive;
  const activeContainerKey = activeId ? findContainerKey(containers, activeId) : null;

  const managerFolders = tree.managers.map((manager) => ({ key: manager.id, name: manager.name }));
  const unassignedClients = containers[UNASSIGNED_KEY] ?? [];

  if (managerFolders.length === 0 && unassignedClients.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mt-1.5 flex min-h-0 flex-col px-2.5">
        {/* Etapa "Identidade Visual KOFF — Sidebar": "Novo cliente" era um
         * CTA de largura total no topo da Sidebar inteira — cadastrar
         * cliente é ação rara e não deveria disputar espaço com a
         * navegação. Vira um "+" discreto aqui, junto do rótulo da seção
         * onde a ação faz sentido contextualmente, disponível sem ocupar
         * espaço nem roubar atenção. */}
        <div className="flex items-center justify-between pb-1">
          <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground-muted">Contas da Agência</p>
          {isAdmin && (
            <Tooltip label="Novo cliente">
              <Link
                href="/clients/new"
                aria-label="Novo cliente"
                className="mitza-pressable flex h-5 w-5 shrink-0 items-center justify-center rounded text-sidebar-foreground-muted transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Tooltip>
          )}
        </div>

        {/* Etapa "Sidebar Areia — Identidade KOFF": nunca uma caixa branca
         * importada de outro sistema sobre a areia — grafite em baixa
         * opacidade (fundo e borda) mantém o campo integrado à superfície,
         * ainda claramente reconhecível como input pelo ícone + borda. */}
        <div className="relative px-0.5 pb-1.5">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground-muted"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Abrir cliente..."
            aria-label="Buscar cliente ou gestor"
            className="w-full rounded-md border border-sidebar-border bg-sidebar-hover py-1 pl-7 pr-2 text-[13px] text-sidebar-foreground placeholder:text-sidebar-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
        </div>

        <ul className="flex flex-col gap-0.5">
          {managerFolders.map((manager) => (
            <ManagerFolder
              key={manager.key}
              folderKey={manager.key}
              name={manager.name}
              clients={containers[manager.key] ?? []}
              isExpanded={isExpanded(manager.key)}
              onToggle={() => toggle(manager.key)}
              activeClientId={activeClientId}
              searchMatchIds={searchMatchIds}
              dragDisabled={dragDisabled}
              isDropTarget={dragOverFolderKey === manager.key}
              isDimmed={activeId !== null && activeContainerKey !== manager.key}
            />
          ))}
          {unassignedClients.length > 0 && (
            <ManagerFolder
              key={UNASSIGNED_KEY}
              folderKey={UNASSIGNED_KEY}
              name="Sem responsável"
              clients={unassignedClients}
              isExpanded={isExpanded(UNASSIGNED_KEY)}
              onToggle={() => toggle(UNASSIGNED_KEY)}
              activeClientId={activeClientId}
              searchMatchIds={searchMatchIds}
              dragDisabled={dragDisabled}
              isDropTarget={dragOverFolderKey === UNASSIGNED_KEY}
              isDimmed={activeId !== null && activeContainerKey !== UNASSIGNED_KEY}
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

      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeId ? (
          <div
            className="flex cursor-grabbing items-center gap-2 rounded-md bg-sidebar-active-surface px-3 py-1.5 text-[13px] font-medium text-sidebar-active-foreground shadow-xl ring-1 ring-sidebar-active-rail"
            style={{ transform: "scale(1.03) rotate(-1deg)" }}
          >
            <span className="min-w-0 truncate">{clientNameById.get(activeId) ?? ""}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
