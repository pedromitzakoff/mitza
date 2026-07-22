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
    }),
    [isOpen, pathname, contextLabel, setContextLabelOverride],
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
