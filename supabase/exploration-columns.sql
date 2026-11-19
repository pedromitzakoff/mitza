-- KOFF Analytics — "Persistência das colunas da tabela de exploração"
-- (pedido explícito do usuário: "quando eu mudo as metricas visualizadas
-- dos cards e tabelas de um cliente essa visualizacao fica salva pra todos
-- e pra sempre... Se nao ficar, faça com que fique... e que isso se
-- replique para o dash na versao do cliente tbm").
--
-- A seleção de colunas das 3 tabelas de exploração (Campanhas/Conjuntos/
-- Anúncios) hoje só é salva no localStorage do navegador — por cliente,
-- por dispositivo, nunca compartilhada entre usuários nem com o link
-- público do cliente (/r/[token]). Estas 3 colunas levam essa seleção pro
-- banco, uma por nível (nunca uma única coluna jsonb — mesmo padrão de
-- `dashboard_metrics`, que já é text[]).
--
-- NULL = "nunca configurado explicitamente" → UI continua usando o
-- default de sempre (colunas com `defaultVisible: true`). Um array (mesmo
-- vazio) = seleção explícita do usuário, sempre respeitada.
alter table public.clients
  add column if not exists exploration_columns_campaigns text[],
  add column if not exists exploration_columns_adsets text[],
  add column if not exists exploration_columns_ads text[];
