-- Etapa 32: quando o gasto manual de uma sprint foi editado pela última vez.
--
-- O gráfico "Planejado acumulado x gasto real acumulado" precisa saber em
-- que dia lançar o valor manual acumulado (ver src/lib/spend-chart-data.ts).
-- Sem essa informação não tem como cumprir a regra "não inventar
-- distribuição diária" — não existia nenhum timestamp de edição na sprint.
--
-- Não apaga nem migra dado nenhum: coluna nasce nula em toda sprint
-- existente (comportamento no gráfico continua igual até a primeira edição
-- manual acontecer, que é quando essa coluna passa a ser preenchida por
-- updateSprintActualSpendAction).

alter table sprints
  add column if not exists manual_spend_updated_at timestamptz;
