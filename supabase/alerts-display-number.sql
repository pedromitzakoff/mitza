-- Aba "Alertas" — pedido do usuário: "pode colocar um número do alerta
-- antes do nome do cliente? assim fica fácil de identificar... como se
-- fosse um número do código do alerta que cada um tem um".
--
-- `GENERATED ALWAYS AS IDENTITY` — nunca um contador calculado em TS (que
-- mudaria de número a cada reload conforme filtro/ordenação) — um número
-- de SEQUÊNCIA fixo, atribuído UMA vez na criação da linha, que nunca
-- muda pelo resto da vida do alerta (mesmo reaberto depois de resolvido —
-- é a MESMA linha, ver `supabase/alerts.sql`). Rode depois de
-- `supabase/alerts.sql`.
--
-- Rodar via Supabase Dashboard -> SQL Editor -> colar e executar.

alter table alerts add column if not exists display_number integer generated always as identity;

comment on column alerts.display_number is
  'Número sequencial legível (nunca a UUID) — atribuído uma vez na criação da linha, nunca recalculado. Pedido do usuário: "como se fosse um número do código do alerta que cada um tem".';
