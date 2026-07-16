"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";

type ToastTone = "success" | "error";

interface ToastContextValue {
  /** Mostra uma confirmação discreta — sempre a mesma posição, animação e
   * duração em toda a plataforma (Platform Continuity System 1.0). Não
   * bloqueia a interface, não muda o contexto, some sozinha.
   *
   * Etapa "Instant Action & Context Memory 1.0": segundo parâmetro opcional
   * `tone` — precisou existir porque a exclusão otimista de tarefa (Parte 3)
   * remove a linha da lista antes do servidor confirmar; se a exclusão
   * falhar, o componente que mostraria o erro inline já foi desmontado (o
   * rollback do `useOptimistic` o traz de volta, mas como uma instância
   * NOVA, sem o estado de erro antigo) — o toast vira o único lugar que
   * sobrevive pra avisar "não deu certo". Omitir preserva `"success"` (o
   * único tom que existia até aqui) em toda chamada já existente. */
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 3500;

/**
 * Único componente de confirmação visual da plataforma inteira — nenhuma
 * tela deve construir sua própria versão. Existe porque, ao remover
 * `redirect()`+`?saved=` de ações cujo resultado não é imediatamente
 * evidente na interface (convite enviado, geração aplicada em lote,
 * cliente restaurado...), o gestor ainda precisa de uma confirmação clara
 * — só que sem navegar. Um único toast de cada vez, de propósito: não é
 * um sistema de notificações, é só "sim, funcionou" (ou, desde a etapa
 * "Instant Action & Context Memory 1.0", "não deu certo" — mesmo
 * componente, mesma posição/animação/duração, só o ícone e a cor do texto
 * mudam com `tone`).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    nextId.current += 1;
    const id = nextId.current;
    setToast({ id, message, tone });
    timeoutRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, TOAST_DURATION_MS);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="mitza-toast-in pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-[var(--shadow-float)]">
            {toast.tone === "error" ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            )}
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Lança uma confirmação a partir de qualquer Client Component — não
 * precisa saber onde o toast é renderizado nem como ele anima. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast precisa estar dentro de um ToastProvider");
  }
  return context;
}
