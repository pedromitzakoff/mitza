import type { AchievementMetricSnapshot, AchievementScope, AchievementSeverity } from "@/lib/achievement-types";

/** Rótulos visíveis — nunca "medalha"/"nível"/"XP" na UI (Auditoria, seção
 * 1). Usado pela página `/achievements` e, futuramente, pela Timeline. */

export const ACHIEVEMENT_SCOPE_LABEL: Record<AchievementScope, string> = {
  client: "Cliente",
  agency: "Agência",
  person: "Pessoa",
};

export const CLIENT_FAMILY_LABEL: Record<string, string> = {
  recordes: "Recordes",
  metas: "Metas",
  consistencia: "Consistência",
  evolucao: "Evolução",
  escala: "Escala",
  recuperacao: "Recuperação",
};

export const AGENCY_FAMILY_LABEL: Record<string, string> = {
  crescimento: "Crescimento",
  carteira: "Carteira",
  operacao: "Operação",
  relacionamento: "Relacionamento",
  escala_midia: "Escala de mídia",
};

export const PERSON_FAMILY_LABEL: Record<string, string> = {
  revisoes: "Revisões",
  otimizacoes: "Otimizações",
  clientes_atendidos: "Clientes atendidos",
  reports: "Reports",
  tempo_de_casa: "Tempo de casa",
  experiencia: "Experiência",
};

export function familyLabelFor(scope: AchievementScope, family: string): string {
  const map = scope === "client" ? CLIENT_FAMILY_LABEL : scope === "agency" ? AGENCY_FAMILY_LABEL : PERSON_FAMILY_LABEL;
  return map[family] ?? family;
}

/** Nunca um sistema de cores/ícones por severidade (seção 16: "visualmente
 * não transformar tudo em carnaval") — só o rótulo interno, pra debug/
 * filtro futuro; a página não diferencia visualmente milestone/highlight/
 * record além do texto natural do headline. */
export const ACHIEVEMENT_SEVERITY_LABEL: Record<AchievementSeverity, string> = {
  milestone: "Marco",
  highlight: "Destaque",
  record: "Recorde",
};

/** Rótulo curto da métrica por trás de uma conquista — usado pela Página de
 * Detalhes (`achievement-detail-drawer.tsx`) pra nomear "atual"/"anterior"
 * sem repetir esse switch em cada tela que já lê `AchievementMetricSnapshot`. */
export const ACHIEVEMENT_METRIC_LABEL: Record<AchievementMetricSnapshot["metric"], string> = {
  cpa: "CPA",
  roas: "ROAS",
  result_count: "Resultados",
  investment: "Investimento",
  count: "Contagem",
};
