import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Botão secundário padrão de Configurações (Etapa "Evolução da Settings")
 * — antes, a mesma className quase idêntica existia reescrita à mão em 4
 * arquivos diferentes (`recurring-tasks-list.tsx`, `sprint-task-templates-list.tsx`,
 * `restore-client-button.tsx`, `backfill-button.tsx`), em zinc cru e
 * text-black cru, uma geração mais antiga que o resto do produto. Cores
 * migradas pros tokens semânticos já usados em Operação/página do Cliente
 * (`border-border`/`text-foreground`) — nenhuma mudança visual perceptível,
 * só a mesma cor lida do token certo. Padding/tamanho de fonte ficam de
 * fora de propósito (cada chamador tem um tamanho diferente hoje — texto
 * pequeno inline numa lista vs. botão de ação isolado maior) — sempre
 * combinado como `` `${SETTINGS_SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs` ``
 * no chamador, nunca duplicado aqui.
 *
 * Etapa "Padronização Global de Estados de Interação": `mitza-pressable`
 * (feedback de "pressionado" ao clicar, mesma classe usada em qualquer
 * outro botão real da plataforma) entra na base das duas variantes —
 * alguns chamadores já a repetiam manualmente (inofensivo, mesma regra
 * aplicada duas vezes); os que não repetiam ficavam sem esse feedback. */
export const SETTINGS_SECONDARY_BUTTON_CLASSES =
  "mitza-pressable rounded-md border border-border font-medium text-foreground hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900";

/** Mesma família acima, variante destrutiva (remover/excluir vínculo) —
 * mesma origem duplicada (2 arquivos), mesma correção. */
export const SETTINGS_DESTRUCTIVE_BUTTON_CLASSES =
  "mitza-pressable rounded-md border border-red-200 font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950";

/**
 * Casco padrão de toda subpágina de Configurações (Etapa "Evolução da
 * Settings") — título, descrição, ação de cabeçalho (quando existir) e link
 * de volta sempre na mesma posição/tamanho, e a mesma largura de conteúdo
 * já usada em Equipe (`/team`), a outra tela irmã de Administração na
 * sidebar. Antes, cada subpágina montava seu próprio cabeçalho: larguras
 * (`max-w-2xl`/`max-w-4xl`/`max-w-6xl`) e tamanhos de título diferentes
 * entre telas da MESMA área. Puramente visual — nenhuma tela perdeu campo,
 * dado ou comportamento, só passou a herdar este invólucro em vez de
 * montar o cabeçalho à mão.
 */
export function SettingsPageShell({
  title,
  description,
  actions,
  backHref,
  backLabel = "Configurações",
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Omitido só no próprio índice (`/settings`) — todas as outras
   * subpáginas voltam pra lá. */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}
