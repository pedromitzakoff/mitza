-- KOFF Analytics — Alertas, novo tipo "Saldo esgotando" (pedido explícito
-- do usuário: "Coloque como alerta quando estivermos 3 dias antes do saldo
-- esgotar se manter o mesmo investimento do dia anterior"). Mesma tabela
-- `alerts`/`alert_events` de sempre — só estende o enum de `alert_type`
-- (nenhuma coluna nova, nenhuma tabela nova). Nenhum valor existente é
-- removido — alertas já gravados não mudam de comportamento.
alter table alerts drop constraint if exists alerts_alert_type_check;
alter table alerts add constraint alerts_alert_type_check check (alert_type in (
  'spend_pace',
  'no_delivery',
  'cost_per_result_increase',
  'spend_without_result',
  'sync_issue',
  'opportunity',
  'balance_depletion'
));
