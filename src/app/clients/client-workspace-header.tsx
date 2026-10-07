"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import { resolveCurrentSuffix } from "@/lib/client-workspace-nav";
import { WORKSPACE_CONTENT_MAX_WIDTH_CLASS } from "./workspace-container";
import { AccountInfoDrawerLauncher } from "./account-info-drawer-launcher";

/**
 * Cabeçalho do workspace do cliente — vive no `layout.tsx` de
 * `clients/[id]/**`, montado em toda navegação entre o cockpit
 * (`/clients/[id]`, MITZA ONE — Fase 1) e as rotas de aprofundamento
 * ainda preservadas (`/metas`, `/relatorio`, `/dados`, `/operation`,
 * `/demandas`, `/timeline`, `/edit`).
 *
 * MITZA ONE — Fase 2 (Sidebar = Carteira, Header Simplificado): a Sidebar
 * virou a fonte principal de seleção/troca de cliente (busca + lista
 * rolável, carrega qualquer cliente visível) — por isso este header
 * deixou de duplicar essa função. Removidos nesta fase (auditoria da
 * Fase 2, seção 3 do pedido):
 *
 * - Seletor/busca de cliente (`SearchableSelect`) — redundante com a
 *   busca da Sidebar, que agora é a única fonte de troca de cliente.
 * - Anterior/próximo — dependiam da MESMA sequência ativo-only de
 *   `resolveWalletSequence`; a Sidebar agora lista também clientes
 *   pausados/encerrados (seção 1 do pedido: "não assumir exclusão"), o
 *   que tornaria anterior/próximo inconsistentes com a ordenação visível
 *   na carteira sempre que o cliente atual não fosse "ativo" — a
 *   instrução da Fase 2 autoriza explicitamente remover quando não há
 *   "comportamento consistente com a ordenação oficial da sidebar"
 *   garantido.
 * - Posição X/Y — consequência direta de anterior/próximo saírem; sem a
 *   sequência, a posição também perde sentido.
 *
 * Preservados (seção 3 do pedido): nome/identidade do cliente (agora como
 * TEXTO visível — antes só existia como placeholder dentro do seletor
 * removido), status CONTRATUAL real (nunca confundido com saúde de
 * performance — `CLIENT_STATUS_LABEL`/`CLIENT_STATUS_BADGE_CLASSES`
 * continuam a única fonte, mesma de sempre) e o drawer "Informações da
 * conta" com todas as suas ações reais (sincronização, compartilhamento,
 * histórico, configuração) — `AccountInfoDrawerLauncher` intocado.
 *
 * O avatar continua sendo o link de volta pro cockpit (`/clients/[id]`)
 * quando a rota atual é uma sub-rota de aprofundamento — única affordance
 * de "voltar" que precisa funcionar de QUALQUER rota, já que clicar no
 * próprio cliente destacado na Sidebar exige achar a linha certa (pode
 * estar fora da área visível com ~100 clientes), enquanto o avatar está
 * sempre à mão.
 */
export function ClientWorkspaceHeader({
  client,
}: {
  client: { id: string; name: string; avatarUrl: string | null; status: ClientContractStatus };
}) {
  const pathname = usePathname();
  const isOnCockpit = resolveCurrentSuffix(pathname, client.id) === "";

  return (
    <div className="border-b border-overview-border bg-overview-surface">
      <div className={`mx-auto flex w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} flex-wrap items-center gap-2.5 px-6 py-3 sm:px-8 lg:px-10`}>
        {isOnCockpit ? (
          <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="sm" />
        ) : (
          <Link href={`/clients/${client.id}`} aria-label={`Voltar para o cockpit de ${client.name}`} className="shrink-0 rounded-full">
            <ClientAvatar name={client.name} imageUrl={client.avatarUrl} size="sm" />
          </Link>
        )}

        <Link
          href={`/clients/${client.id}`}
          className="min-w-0 truncate text-sm font-semibold text-overview-text-primary hover:underline"
        >
          {client.name}
        </Link>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}>
          {CLIENT_STATUS_LABEL[client.status]}
        </span>

        <div className="ml-auto shrink-0">
          <AccountInfoDrawerLauncher
            clientId={client.id}
            triggerClassName="text-xs font-medium text-overview-text-secondary hover:text-overview-text-primary hover:underline"
          />
        </div>
      </div>
    </div>
  );
}
