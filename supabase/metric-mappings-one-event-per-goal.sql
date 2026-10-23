-- KOFF Analytics — "Um evento por objetivo, nunca somar" (pedido explícito
-- do usuário). Reverte a decisão de `stract-metric-mappings-multi-column.sql`
-- (permitir mais de 1 coluna ativa por objetivo, somadas) — achado real que
-- motivou a reversão: uma conta com "lead" (formulário) e "mensagem
-- iniciada" mapeados juntos pro objetivo Leads relatou 40 leads no mês,
-- quando só 20 eram formulários de verdade — as outras 20 eram mensagens
-- que nem chegaram até o cliente (WhatsApp/Direct mal configurado). "Lead
-- de formulário é uma coisa, lead de mensagem é outra" — cada evento
-- precisa da própria métrica, nunca fundido com outro sob o mesmo rótulo.
--
-- `saveMetricMappingAction` (`src/app/settings/meta-connections/actions.ts`)
-- já foi corrigida pra nunca mais criar um segundo mapeamento ativo pro
-- mesmo objetivo (salvar um novo desativa o anterior automaticamente) —
-- esta migração só adiciona a garantia no NÍVEL DO BANCO, pra nenhum outro
-- caminho de escrita (futuro, ou um SQL manual) conseguir reintroduzir o
-- mesmo bug.
--
-- ORDEM DE EXECUÇÃO IMPORTANTE:
--
-- 1) Rode primeiro a consulta de diagnóstico abaixo (só leitura) e REVISE
--    o resultado. Se alguma conta aparecer, significa que ela tem mais de
--    1 evento ativo pro MESMO objetivo hoje — decida manualmente, pelo
--    contexto da conta (qual evento é o "de verdade"), e desative o errado
--    pela própria tela /settings/meta-connections ("Desativar", na
--    conexão daquele cliente) ANTES de seguir pro passo 2.
--
-- 2) Só depois de zerar o resultado da consulta abaixo, rode a troca de
--    constraint no fim deste arquivo. Ela FALHA com um erro claro do
--    Postgres (unique violation) se ainda houver alguma conta com mais de
--    1 evento ativo pro mesmo objetivo — nunca aplica parcialmente, nunca
--    desativa nada sozinha. Repita o passo 1 e tente de novo.

-- Passo 1 — diagnóstico (só leitura): contas com mais de 1 evento ativo
-- pro MESMO objetivo agora mesmo.
select
  mm.import_source_id,
  isrc.client_id,
  c.name as client_name,
  mm.goal,
  array_agg(mm.result_column order by mm.created_at) as result_columns_ativos,
  count(*) as quantos_eventos_ativos
from metric_mappings mm
join import_sources isrc on isrc.id = mm.import_source_id
join clients c on c.id = isrc.client_id
where mm.active
group by mm.import_source_id, isrc.client_id, c.name, mm.goal
having count(*) > 1
order by c.name, mm.goal;

-- Passo 2 — só depois do diagnóstico acima voltar vazio: restaura a
-- constraint original (1 evento ativo por objetivo, nunca mais de um).
drop index if exists metric_mappings_one_active_per_source_result_column;

create unique index if not exists metric_mappings_one_active_per_source_goal
  on metric_mappings (import_source_id, goal) where active;

comment on table metric_mappings is
  'Mapeamento de qual evento (action_type) representa cada objetivo — específico por objetivo (diferente de import_sources, que guarda o que é comum a toda a fonte). SEMPRE no máximo 1 evento ativo por objetivo ao mesmo tempo (pedido explícito do usuário: "não quero que fique somando" — lead de formulário e lead de mensagem são eventos diferentes, cada um com sua própria métrica, nunca fundidos sob o mesmo objetivo). Trocar o evento de um objetivo é sempre desativar a linha atual (active=false) e inserir uma nova — nunca UPDATE em result_column/value_column — histórico fica gravado em created_at, sem tabela extra. `saveMetricMappingAction` já aplica essa troca automaticamente ao salvar.';
