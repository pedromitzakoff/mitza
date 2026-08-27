/**
 * Etapa "Revisão da Visão Geral": este módulo existia inteiro pra projetar
 * `ClientDiagnostics` no shape de "Prioridades de hoje" — painel removido da
 * Visão Geral (virou uma ponte compacta pra Operação, que já tem sua própria
 * fila detalhada). `OverviewPriorityFilter` sobrevive sozinho porque ainda
 * identifica as 4 opções do filtro "Diagnóstico" da barra de filtros
 * (`agency-filters.tsx`), que continua existindo — o resto do arquivo
 * (`OverviewPriorityItem`, `buildOverviewPriorityItem`,
 * `hasActiveOverviewDiagnostic`) não tem mais nenhum consumidor e foi
 * removido junto do painel.
 */
export type OverviewPriorityFilter = "planejamento" | "investimento" | "cpa" | "pendencias";
