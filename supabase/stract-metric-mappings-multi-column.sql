-- Integração Stract (ver docs/STRACT_INTEGRATION_ARCHITECTURE.md) — um
-- objetivo pode ser alimentado por MAIS DE UMA coluna de origem. Achado real:
-- um cliente com objetivo "leads" pode rodar campanha de formulário (uma
-- métrica do Meta) e campanha de WhatsApp/Messenger (outra métrica
-- completamente diferente) ao mesmo tempo — no Meta/Stract são ações
-- distintas, mas na MITZA é tudo lead, somado no mesmo dia.
--
-- A constraint original (`metric_mappings_one_active_per_source_goal`, 1
-- mapeamento ativo por objetivo) impedia isso. A nova permite várias
-- colunas ativas pro mesmo objetivo, mas ainda impede mapear a MESMA coluna
-- duas vezes pro mesmo objetivo (isso seria redundante/sem sentido).
--
-- O código (`lib/stract-sync.ts`) já foi ajustado pra somar todas as colunas
-- de um mesmo objetivo (`combineAggregatedDailyValues`) antes de gravar em
-- `daily_performance` — sem essa mudança de código, permitir múltiplas
-- colunas faria a última sobrescrever as anteriores (mesma chave de upsert),
-- em vez de somar.
drop index if exists metric_mappings_one_active_per_source_goal;

create unique index if not exists metric_mappings_one_active_per_source_result_column
  on metric_mappings (import_source_id, goal, result_column) where active;

comment on table metric_mappings is
  'Mapeamento de qual(is) coluna(s) da fonte representa(m) cada objetivo — específico por objetivo (diferente de import_sources, que guarda o que é comum a toda a fonte). Um objetivo pode ter mais de uma coluna ativa ao mesmo tempo (ex.: leads via formulário + leads via WhatsApp) — todas somadas por dia pelo Import Service. Nunca UPDATE em result_column/value_column: pra mudar, desativa a linha (active=false) e insere uma nova — histórico fica gravado em created_at, sem tabela extra.';
