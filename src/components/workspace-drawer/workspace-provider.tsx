"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { defaultWorkspaceContextLabel } from "@/lib/workspace-notes";

interface WorkspaceContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Caminho atual — vira `context_path` de qualquer nota criada agora. */
  contextPath: string;
  /** Rótulo do contexto atual — o padrão por rota, a menos que a própria
   * página tenha registrado um mais específico (ex.: nome do cliente) via
   * `useWorkspaceContextLabel`. */
  contextLabel: string;
  setContextLabelOverride: (label: string | null) => void;
  /** Nome do cliente ativo (Etapa "MEGA FACELIFT — Fase 4.5: Navegação da
   * Carteira", seção 10 do pedido) — `null` fora de `/clients/[id]/**`.
   * Deliberadamente um campo PRÓPRIO, nunca reaproveitando `contextLabel`
   * acima: aquele é tied a pathname exato (só sobrevive enquanto a MESMA
   * rota que o registrou está montada — pensado pra rótulo de nota, não
   * pra persistir durante a navegação entre módulos do mesmo cliente).
   * Este é registrado pelo `layout.tsx` do workspace (montado em TODAS as
   * sub-rotas de `/clients/[id]/**`), então sobrevive à troca de módulo
   * (Dashboard -> Metas) e só volta a `null` ao sair do workspace. */
  activeClientName: string | null;
  setActiveClientName: (name: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * MITZA 2.0 — Workspace Pessoal: montado uma única vez no AppShell (que
 * persiste entre navegações client-side, já que é o layout raiz), então o
 * estado de aberto/fechado e o rascunho da nota sobrevivem a trocar de
 * página — igual pedido ("o usuário continua exatamente na mesma tela").
 * Nunca mexe na navegação principal: abrir/fechar é só um boolean local,
 * sem router.push nem mudança de URL.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [isOpen, setIsOpen] = useState(false);
  // Guarda a rota em que o override foi registrado — se a rota mudou desde
  // então, o override é tratado como obsoleto na hora de calcular
  // `contextLabel` (derivado no render, não via `useEffect`+`setState`: o
  // nome do cliente da página anterior nunca vaza pra próxima sem precisar
  // de um efeito extra só pra "limpar" estado).
  const [override, setOverride] = useState<{ path: string; label: string } | null>(null);
  const [activeClientName, setActiveClientName] = useState<string | null>(null);

  const setContextLabelOverride = useCallback(
    (label: string | null) => {
      setOverride(label === null ? null : { path: pathname, label });
    },
    [pathname],
  );

  const contextLabel = override && override.path === pathname ? override.label : defaultWorkspaceContextLabel(pathname);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      contextPath: pathname,
      contextLabel,
      setContextLabelOverride,
      activeClientName,
      setActiveClientName,
    }),
    [isOpen, pathname, contextLabel, setContextLabelOverride, activeClientName],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace precisa estar dentro de WorkspaceProvider");
  return ctx;
}

/** Registra um rótulo de contexto mais específico que o padrão da rota
 * (ex.: nome do cliente em `/clients/[id]`) enquanto o componente chamador
 * estiver montado; some (volta ao padrão da rota) ao desmontar. */
export function useWorkspaceContextLabel(label: string): void {
  const { setContextLabelOverride } = useWorkspace();

  useEffect(() => {
    setContextLabelOverride(label);
    return () => setContextLabelOverride(null);
  }, [label, setContextLabelOverride]);
}

/** Registra o nome do cliente ativo (Etapa "MEGA FACELIFT — Fase 4.5",
 * seção 10 do pedido) — chamado pelo `layout.tsx` do workspace, que
 * continua montado em QUALQUER módulo de `/clients/[id]/**` (Dashboard,
 * Metas, Performance...), então o nome sobrevive à troca de módulo do
 * mesmo cliente e só volta a `null` ao desmontar (saiu do workspace).
 * Reage a `name` mudar sem desmontar (troca de cliente via seletor/
 * anterior-próximo, que o Next.js pode resolver sem desmontar o layout). */
export function useActiveClientName(name: string): void {
  const { setActiveClientName } = useWorkspace();

  useEffect(() => {
    setActiveClientName(name);
    return () => setActiveClientName(null);
  }, [name, setActiveClientName]);
}
