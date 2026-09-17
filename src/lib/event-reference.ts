/**
 * Etapa "Timeline 2.0" — referência humana curta pra qualquer
 * `operational_events.id` (UUID) e a estrutura de RELAÇÃO entre eventos.
 *
 * Auditoria (seção 11 do pedido): `operational_events.id` já é um UUID
 * estável — nunca precisamos de um contador global novo (frágil, exigiria
 * migration e serialização de escrita). A referência humana (`#EVT-XXXXXXXX`)
 * é só uma FORMATAÇÃO de exibição sobre esse UUID já existente — os 8
 * primeiros caracteres hex, maiúsculos. Nunca é usada como CHAVE DE BUSCA:
 * qualquer link/relação sempre carrega o UUID completo por baixo (ver
 * `EventRelation`), então uma colisão visual entre dois `#EVT-XXXXXXXX`
 * (estatisticamente improvável no volume desta plataforma) é, na pior
 * hipótese, um rótulo repetido — nunca um erro de dado ou de navegação.
 *
 * Relação entre eventos (seção 12): guardada dentro do `metadata` jsonb já
 * existente de `operational_events` (`related_event_id`/`relation_type`) —
 * nenhuma tabela nova. Nenhum detector desta etapa ainda escreve essa
 * relação (ver relatório da etapa — triangulação automática fica pra
 * próxima fase); esta é só a LEITURA genérica, pronta pra qualquer detector
 * futuro popular.
 *
 * Nomenclatura (seção 3, obrigatória): nunca `caused_by`/`impact_caused_by`/
 * `optimization_result` — só `occurred_after` por enquanto (o único tipo de
 * relação que a plataforma pode honestamente afirmar: proximidade temporal,
 * nunca causalidade).
 */

/** `#EVT-XXXXXXXX` — 8 primeiros caracteres hex do UUID, maiúsculos. Pura,
 * determinística: o mesmo `id` sempre produz a mesma referência. */
export function formatEventReference(id: string): string {
  return `#EVT-${id.slice(0, 8).toUpperCase()}`;
}

export type EventRelationType = "occurred_after";

export interface EventRelation {
  relatedEventId: string;
  relationType: EventRelationType;
}

/** Lê `metadata.related_event_id`/`metadata.relation_type` quando presentes
 * — `null` quando ausentes (a grande maioria dos eventos hoje, incluindo
 * todo `achievement_unlocked` já persistido) ou quando `relation_type` não é
 * um valor reconhecido (nunca inventa uma relação a partir de dado
 * malformado). Pura, sem I/O — a busca do evento relacionado em si
 * (`resolveEventById`) é responsabilidade de quem consome isto. */
export function parseEventRelation(metadata: Record<string, unknown> | null): EventRelation | null {
  if (!metadata) return null;
  const relatedEventId = metadata.related_event_id;
  const relationType = metadata.relation_type;
  if (typeof relatedEventId !== "string" || relatedEventId.length === 0) return null;
  if (relationType !== "occurred_after") return null;
  return { relatedEventId, relationType };
}
