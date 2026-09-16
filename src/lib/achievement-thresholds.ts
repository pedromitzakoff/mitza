/**
 * Limiares centrais do motor de Conquistas — nenhum número de amostra,
 * janela ou magnitude deve existir fora deste arquivo (mesmo padrão de
 * `operation-health-thresholds.ts` pro Motor de Saúde). Mudar um valor aqui
 * reclassifica toda a avaliação; nunca uma segunda constante duplicada num
 * arquivo de regra.
 *
 * Deliberadamente NÃO reaproveita `MIN_RELIABLE_RESULT_COUNT`
 * (`operation-health-thresholds.ts`) por import direto — mesmo espírito
 * (nunca confiar em amostra pequena), mas conquista é permanente e pode
 * virar mensagem pro cliente, então a barra é mais alta e vive isolada:
 * mudar o Motor de Saúde nunca deve alterar silenciosamente uma Conquista.
 *
 * "Amostra mínima não pode ser igual pra tudo" (determinação de aprovação
 * nº1) — por isso políticas nomeadas, uma por natureza de janela, em vez de
 * um único bloco aplicado cegamente a toda regra.
 */

// ---------------------------------------------------------------------------
// Amostra de JANELA AGREGADA — Recordes de semana/mês e cada perna de uma
// comparação (Evolução/Escala). `minDaysWithData` = contagem fixa (janelas
// de tamanho fixo); `minDaysCoveragePct` = fração dos dias DECORRIDOS da
// janela (meses, que podem estar em andamento).
// ---------------------------------------------------------------------------
export interface WindowSamplePolicy {
  minResultCount: number;
  minSpend: number;
  minDaysWithData?: number;
  minDaysCoveragePct?: number;
}

export const WINDOW_SAMPLE_POLICY = {
  week: { minResultCount: 5, minSpend: 150, minDaysWithData: 4 } satisfies WindowSamplePolicy,
  d7: { minResultCount: 5, minSpend: 150, minDaysWithData: 4 } satisfies WindowSamplePolicy,
  month: { minResultCount: 8, minSpend: 400, minDaysCoveragePct: 0.8 } satisfies WindowSamplePolicy,
};

// ---------------------------------------------------------------------------
// Amostra de DIA — usada pelo classificador de streak (Consistência/
// Recuperação, ver `achievement-day-classification.ts`). Bem menor que a de
// janela de propósito: um único dia nunca precisa da mesma barra de uma
// semana inteira, só precisa ser mídia de verdade rodando (não R$2 de gasto
// sustentando artificialmente uma sequência).
// ---------------------------------------------------------------------------
export const DAILY_ELIGIBILITY_POLICY = {
  minSpend: 20,
  minResultCount: 1,
};

// ---------------------------------------------------------------------------
// Meta mensal — natureza própria (determinação nº1, exemplo do próprio
// pedido de aprovação): o volume acumulado que bateu a meta já É a prova de
// amostra, não precisa de um piso de resultado redundante. O que precisa de
// piso é o PRÓPRIO ALVO (não pontuar um alvo trivial/mal configurado) e a
// COBERTURA de dias sincronizados no mês (não confiar num mês com buracos).
// ---------------------------------------------------------------------------
export const MONTHLY_GOAL_MIN_TARGET_RESULT_COUNT = 5;
export const MONTHLY_GOAL_MIN_DATA_COVERAGE_PCT = 0.8;

// ---------------------------------------------------------------------------
// Streak — quantos dias olhar pra trás ao recomputar uma sequência (nunca
// estado persistido, ver arquitetura aprovada). Maior que o maior threshold
// de streak da V1 (14 dias) com folga suficiente pra absorver dias neutros
// no meio sem cortar a sequência real.
// ---------------------------------------------------------------------------
export const STREAK_LOOKBACK_DAYS = 45;

// ---------------------------------------------------------------------------
// Escala — crescimento mínimo de investimento e tolerância de deterioração
// de CPA permitida pra ainda contar como "mantendo eficiência". Nunca uma
// tolerância escondida num componente — só aqui.
// ---------------------------------------------------------------------------
export const SCALE_MIN_INVESTMENT_GROWTH_PCT = 0.2;
export const SCALE_MAX_CPA_DETERIORATION_PCT = 0; // 0 = CPA precisa continuar dentro da meta, nenhuma tolerância além disso na V1

// ---------------------------------------------------------------------------
// Evolução — magnitudes de melhora exigidas (CPA reduz, ROAS/resultado
// crescem) pra cada família.
// ---------------------------------------------------------------------------
export const EVOLUTION_CPA_IMPROVEMENT_PCT = 0.2;
export const EVOLUTION_ROAS_GROWTH_PCT = 0.25;

// ---------------------------------------------------------------------------
// Metas — múltiplos de meta mensal reconhecidos na V1 (só o maior patamar
// atingido é emitido, nunca os dois — ver `achievement-engine.ts`).
// ---------------------------------------------------------------------------
export const MONTHLY_GOAL_MULTIPLIERS = [1.25, 1.0];

// ---------------------------------------------------------------------------
// Consistência — dias de mídia consecutivos elegíveis reconhecidos na V1.
// ---------------------------------------------------------------------------
export const CONSISTENCY_STREAK_THRESHOLDS = [14, 7];

// ---------------------------------------------------------------------------
// Recuperação — quantos dias "fora" (estado ruim) antes precisam ter
// existido pra uma virada contar como recuperação de verdade (nunca uma
// oscilação de 1 dia), e quantos dias "dentro" confirmam a virada.
// ---------------------------------------------------------------------------
export const RECOVERY_MIN_BAD_STREAK_DAYS = 5;
export const RECOVERY_MIN_CONFIRMATION_DAYS = 3;

// ---------------------------------------------------------------------------
// Agência/Pessoa — escadas de contagem simples (mesmo espírito: só o maior
// patamar cruzado numa mesma avaliação é emitido).
// ---------------------------------------------------------------------------
export const AGENCY_ACTIVE_CLIENTS_MILESTONES = [100, 75, 50, 25, 10];
export const AGENCY_HEALTHY_WALLET_MILESTONES = [1.0, 0.9, 0.8]; // fração da carteira saudável (1.0 = também "sem crítico")
export const AGENCY_REVIEWS_MILESTONES = [1000, 500, 100];
export const AGENCY_OPTIMIZATIONS_MILESTONES = [1000, 500, 100];
export const AGENCY_REPORTS_MILESTONES = [1000, 500, 100];
export const AGENCY_MEDIA_SCALE_MILESTONES = [1_000_000, 500_000, 250_000, 100_000];

export const PERSON_REVIEWS_MILESTONES = [500, 250, 100, 50, 1];
export const PERSON_OPTIMIZATIONS_MILESTONES = [500, 250, 100, 50, 1];
export const PERSON_CLIENTS_SERVED_MILESTONES = [50, 25, 10, 1];
export const PERSON_REPORTS_MILESTONES = [100, 50, 25, 1];
export const PERSON_TENURE_MONTHS_MILESTONES = [24, 12, 6];

// ---------------------------------------------------------------------------
// Etapa "Conquistas por Granularidade" — campanha/público/criativo. Amostra
// própria, MENOR que `WINDOW_SAMPLE_POLICY.d7` de propósito: uma campanha/
// público/criativo individual naturalmente move um volume menor que a conta
// inteira, então exigir a mesma barra da conta tornaria os 3 novos níveis
// praticamente mudos. Ainda assim não trivial — 3 resultados/R$100 numa
// semana é o piso mínimo pra sustentar qualquer afirmação de "melhor"/
// "melhorou", nunca 1 resultado isolado ou um gasto irrelevante (seção 5/6/7
// do pedido: "não gerar conquista com 1 resultado ou gasto irrelevante").
// ---------------------------------------------------------------------------
export const SUB_ENTITY_WINDOW_SAMPLE_POLICY: WindowSamplePolicy = {
  minResultCount: 3,
  minSpend: 100,
  minDaysWithData: 3,
};

/** "Destaque" (melhor CPA/CPL da conta) exige pelo menos esta quantidade de
 * entidades (campanhas/públicos/criativos) com amostra válida no MESMO
 * período — nunca "melhor" sem concorrência real (seção 5 do pedido: "não
 * chamar simplesmente a campanha com menor CPA de 'melhor' se ela teve
 * amostra irrelevante" — extrapolado aqui pra também nunca chamar de
 * "melhor" quem não tinha ninguém comparável pra perder). */
export const SUB_ENTITY_MIN_COMPARABLE_ENTITIES = 2;

/** Revisão do detector "Destaque": mudar de líder (menor CPA hoje vs. ontem)
 * NUNCA é suficiente sozinho — precisa ser uma vantagem MATERIAL sobre o
 * conjunto das demais entidades comparáveis, não só sobre a segunda
 * colocada isolada (diferenças de ranking podem ser irrelevantes). A
 * vantagem é medida como `(CPA agregado das demais − CPA da destaque) /
 * CPA agregado das demais`, exigindo este piso mínimo pra contar.
 *
 * Mesma magnitude já usada em `EVOLUTION_CPA_IMPROVEMENT_PCT`/
 * `SCALE_MIN_INVESTMENT_GROWTH_PCT` — 20% já é o piso que o resto do motor
 * usa pra "isso é uma diferença real", nunca um segundo número inventado
 * sem relação com o que já existe. */
export const SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT = EVOLUTION_CPA_IMPROVEMENT_PCT;

// ---------------------------------------------------------------------------
// Controle de ruído (seção 8/9 do pedido) — teto de quantas conquistas de
// CLIENTE (todos os níveis somados) o motor emite por cliente por dia.
// Prioriza severidade (record > highlight > milestone) e, dentro da mesma
// severidade, nível mais amplo primeiro (conta > campanha > público >
// criativo — ver `achievement-engine.ts`) — nunca uma lógica semântica de
// "isso já foi dito de outro jeito" (deliberadamente simples, seção 9: "não
// implemente uma regra complexa sem necessidade").
// ---------------------------------------------------------------------------
export const MAX_CLIENT_ACHIEVEMENTS_PER_DAY = 3;
