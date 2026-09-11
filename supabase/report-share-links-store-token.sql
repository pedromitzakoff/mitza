-- Etapa "Link Externo — token recuperável" (pedido explícito do usuário,
-- decisão consciente de trade-off de segurança): `report_share_links`
-- passa a guardar também o token BRUTO, não só o hash — pra o painel "Link
-- do cliente" conseguir reexibir o mesmo link a qualquer momento, sem
-- obrigar quem gera a copiar na hora (senão precisava gerar de novo,
-- revogando o anterior, só pra ver o valor de novo).
--
-- O Relatório de Performance é só leitura (nada editável, nenhum dado além
-- do que o relatório já mostra pro gestor) — por isso o risco aceito aqui é
-- menor do que em qualquer token que desse acesso de escrita. `token_hash`
-- e a resolução de `/r/[token]` (lib/report-share-links.ts,
-- `resolveClientIdFromShareToken`) continuam EXATAMENTE como antes — a
-- busca pública segue indexada pelo hash, nunca pelo valor bruto. Só o
-- painel administrativo (`getReportShareLinkStatus`) passa a enxergar
-- `token`.
--
-- Rode depois de supabase/report-share-links.sql.

alter table report_share_links add column if not exists token text;

comment on column report_share_links.token is
  'Token bruto do link — persistido desde a Etapa "Link Externo — token recuperável" pra o painel administrativo poder reexibi-lo a qualquer momento. Linhas criadas antes desta etapa ficam null (link ainda ativo, mas sem valor reexibível — só nesse caso peça pra gerar um novo). Nunca usado pra resolver /r/[token] (isso continua via token_hash); só para exibição no painel "Link do cliente".';

comment on column report_share_links.token_hash is
  'sha256 hex do token bruto — continua sendo o único usado pra resolver /r/[token] (busca indexada por hash). Desde a Etapa "Link Externo — token recuperável", o valor bruto TAMBÉM fica persistido na coluna token, ao lado deste — decisão consciente (ver comentário da tabela).';

comment on table report_share_links is
  'Link externo seguro do Performance Report (/r/[token]) — cada linha vincula um token a exatamente um client_id. Desde a Etapa "Link Externo — token recuperável", tanto o hash (token_hash, usado pra resolver /r/[token]) quanto o valor bruto (token, usado só pra reexibição no painel administrativo) são persistidos — decisão consciente de trade-off de segurança, aceitável porque o relatório é só leitura. Sem nenhuma policy de RLS: leitura/escrita só via createAdminClient() (service role), nunca a partir de um client do browser.';
