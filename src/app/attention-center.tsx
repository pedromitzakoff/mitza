import Link from "next/link";
import type { AttentionCenterCategory, AttentionCenterCounts, AttentionCenterItem } from "@/lib/attention-center";

const CATEGORY_DOT_CLASSES: Record<AttentionCenterCategory, string> = {
  sem_execucao: "bg-zinc-400 dark:bg-zinc-600",
  tarefas_criticas: "bg-red-500",
  investimento: "bg-amber-500",
  comentarios: "bg-blue-500",
};

function AttentionRow({ item }: { item: AttentionCenterItem }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT_CLASSES[item.category]}`} />
          <span className="truncate text-sm font-semibold text-foreground">{item.clientName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">· {item.title}</span>
        </div>
        <p className="mt-0.5 text-xs text-foreground">{item.description}</p>
        <p className="text-[11px] text-muted-foreground">{item.context}</p>
      </div>
      <Link
        href={item.actionHref}
        className="shrink-0 self-center rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        {item.actionLabel}
      </Link>
    </li>
  );
}

/** Faixa de resumo do topo — só as categorias implementadas (Comentários
 * fica oculta enquanto não houver estado confiável nos comentários pra
 * calculá-la, em vez de mostrar um contador falso igual a zero). */
function SummaryStrip({ counts }: { counts: AttentionCenterCounts }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <span>
        <span className="font-semibold text-foreground">{counts.tarefasCriticas}</span>{" "}
        <span className="text-muted-foreground">crítico{counts.tarefasCriticas !== 1 ? "s" : ""}</span>
      </span>
      <span>
        <span className="font-semibold text-foreground">{counts.semExecucao}</span>{" "}
        <span className="text-muted-foreground">sem execução</span>
      </span>
      <span>
        <span className="font-semibold text-foreground">{counts.investimento}</span>{" "}
        <span className="text-muted-foreground">investimento fora do ritmo</span>
      </span>
    </div>
  );
}

/**
 * Bloco compacto da Visão Geral — no máximo 5 itens (já filtrados/ordenados
 * por quem chama), cada um respondendo cliente/problema/contexto/ação.
 * Nunca cards grandes: uma lista densa com separador sutil entre linhas.
 */
export function AttentionCenterPanel({
  items,
  counts,
  totalCount,
  viewAllHref,
}: {
  items: AttentionCenterItem[];
  counts: AttentionCenterCounts;
  totalCount: number;
  viewAllHref: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Central de atenção</h2>
        {totalCount > items.length && (
          <Link href={viewAllHref} className="text-xs font-medium text-brand hover:underline">
            Ver tudo ({totalCount})
          </Link>
        )}
      </div>

      {items.length > 0 ? (
        <>
          <div className="mt-1.5">
            <SummaryStrip counts={counts} />
          </div>
          <ul className="mt-1 divide-y divide-border">
            {items.map((item, index) => (
              <AttentionRow key={`${item.clientId}-${item.category}-${index}`} item={item} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma situação prioritária no momento.</p>
      )}
    </div>
  );
}

const CATEGORY_FILTER_OPTIONS: { value: AttentionCenterCategory | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "tarefas_criticas", label: "Tarefas críticas" },
  { value: "sem_execucao", label: "Sem execução" },
  { value: "investimento", label: "Investimento" },
];

/**
 * "Ver tudo" — drawer lateral (mesmo padrão de TaskDrawerPanel: link
 * fixed-overlay + painel fixo à direita, aberto/fechado via query param, sem
 * JS de estado próprio) com todos os itens e um filtro simples por categoria.
 */
export function AttentionCenterDrawer({
  items,
  category,
  closeHref,
  buildCategoryHref,
}: {
  items: AttentionCenterItem[];
  category: AttentionCenterCategory | "todos";
  closeHref: string;
  buildCategoryHref: (category: AttentionCenterCategory | "todos") => string;
}) {
  const filtered = category === "todos" ? items : items.filter((item) => item.category === category);

  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Central de atenção</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {CATEGORY_FILTER_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={buildCategoryHref(option.value)}
              scroll={false}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                category === option.value
                  ? "bg-brand text-white"
                  : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {filtered.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {filtered.map((item, index) => (
              <AttentionRow key={`${item.clientId}-${item.category}-${index}`} item={item} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma situação nesta categoria.</p>
        )}
      </div>
    </>
  );
}
