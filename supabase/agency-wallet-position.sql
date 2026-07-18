-- Etapa "Árvore Viva 1.0" (drag and drop rico): posição manual do cliente
-- dentro da carteira do gestor responsável — permite reordenar clientes
-- dentro da mesma pasta e escolher a posição exata ao trocar de gestor
-- (início/meio/fim), sem depender de renumerar a pasta inteira a cada
-- movimento.
--
-- NÃO EXECUTAR sem aprovação — rodar manualmente no SQL Editor do Supabase
-- quando o admin decidir aplicar (mesmo padrão de toda migration deste
-- projeto que altera schema já em produção).
--
-- Aditivo: 1 coluna nullable, nenhum dado existente é reescrito além do
-- backfill determinístico abaixo (que só preenche linhas ainda sem valor).

alter table clients add column if not exists wallet_position numeric(14, 4);

comment on column clients.wallet_position is
  'Posição manual do cliente dentro da carteira do gestor responsável (ou de "Sem responsável", quando primary_manager_id é null) — fracionária, múltiplos de 1000 na inicialização (ver MIN_POSITION_GAP em lib/agency-wallet-position.ts). Inserir um cliente entre dois outros só reescreve a própria linha (média dos vizinhos); a pasta inteira só é renumerada pela rotina de normalização de segurança, quando a diferença entre vizinhos fica pequena demais.';

-- Backfill determinístico: dentro de cada gestor (e dentro de "Sem
-- responsável", agrupados via coalesce), ordena por nome — mesmo critério
-- estável já usado como ORDER BY padrão da árvore/listagens hoje — e
-- atribui múltiplos de 1000. Só preenche linhas ainda sem posição (seguro
-- rodar de novo).
with ranked as (
  select id, row_number() over (
    partition by coalesce(primary_manager_id::text, 'unassigned')
    order by name
  ) as rn
  from clients
)
update clients c
set wallet_position = ranked.rn * 1000
from ranked
where c.id = ranked.id and c.wallet_position is null;
