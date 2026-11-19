import type {
  AlertEventTypeDb,
  AlertPeriodKindDb,
  AlertReferenceSourceDb,
  AlertSeverityDb,
  AlertStatusDb,
  AlertTypeDb,
} from "@/lib/supabase/database.types";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Aba "Alertas" — tipos compartilhados entre detecção (pura), persistência
 * (`alert-persistence.ts`) e UI (`src/app/alerts/`). Reexporta os enums do
 * banco (`database.types.ts`) em vez de redeclará-los — único ponto de
 * definição.
 */
export type AlertType = AlertTypeDb;
export type AlertPeriodKind = AlertPeriodKindDb;
export type AlertSeverity = AlertSeverityDb;
export type AlertStatus = AlertStatusDb;
export type AlertReferenceSource = AlertReferenceSourceDb;
export type AlertEventType = AlertEventTypeDb;

/** Entrega incremental (decisão do usuário): "spend_pace" e
 * "balance_depletion" (pedido explícito: "coloque como alerta quando
 * estivermos 3 dias antes do saldo esgotar") são avaliados nesta fase — os
 * demais existem no enum do banco pra não exigir nova migração, mas nenhum
 * avaliador ainda os produz. */
export const IMPLEMENTED_ALERT_TYPES: readonly AlertType[] = ["spend_pace", "balance_depletion"];

export interface AlertRow {
  id: string;
  clientId: string;
  channel: TrafficChannel;
  alertType: AlertType;
  periodKind: AlertPeriodKind;
  severity: AlertSeverity;
  status: AlertStatus;
  periodStart: string;
  periodEnd: string;
  observedValue: number | null;
  referenceValue: number | null;
  diffPercent: number | null;
  referenceIsEstimate: boolean;
  referenceSource: AlertReferenceSource | null;
  explanation: string;
  detail: Record<string, unknown>;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  resolvedAt: string | null;
  followUpUntil: string | null;
}

/** O que um avaliador pede pra gravar quando a condição está presente —
 * nunca inclui `status`/`id`/timestamps de controle, que são decididos pelo
 * reducer de persistência (`alert-persistence.ts`), nunca pelo detector. */
export interface AlertCandidate {
  severity: AlertSeverity;
  periodStart: string;
  periodEnd: string;
  observedValue: number;
  referenceValue: number;
  diffPercent: number;
  referenceIsEstimate: boolean;
  referenceSource: AlertReferenceSource | null;
  explanation: string;
  detail: Record<string, unknown>;
}
