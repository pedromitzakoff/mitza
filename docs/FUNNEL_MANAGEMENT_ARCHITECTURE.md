# Gestão de Funis Estratégicos por Cliente

## Objetivo

Permitir que o gestor crie e administre funis estratégicos (Captação, Vendas, Distribuição de Conteúdo, ou qualquer outra frente que a conta precise) direto no painel, classifique campanhas reais dentro de cada funil e analise cada funil separadamente no Relatório — sem depender do desenvolvedor pra cadastrar uma nova frente estratégica.

## Contexto e decisão central

Uma auditoria estrutural anterior a esta etapa identificou quatro estruturas com responsabilidades parcialmente sobrepostas: `client_goals`/`client_campaign_goal_assignments` (meta de resultado por objetivo), `campaign_report_classifications` (finalidade da campanha, introduzida na etapa imediatamente anterior a esta — "Separar o Relatório por finalidade das campanhas" — com **zero linhas em produção**) e `campaign_daily_metrics.result_type` (sinal técnico da Meta, via `metric_mappings`).

Decisão explícita: **não criar uma quarta fonte de verdade**. Em vez disso, `campaign_report_classifications` foi **transformada** em `campaign_funnel_assignments` (mesma tabela, coluna `purpose` — um enum fixo de 7 valores — trocada por `funnel_id`, uma FK pra um funil configurável pelo painel). Essa transformação foi segura porque a tabela nunca tinha uma linha real gravada (nenhum cliente em produção tinha `campaign_id_column` configurado até o momento desta migration).

### Responsabilidade de cada conceito (nunca confundidos)

| Conceito | Tabela | Quem decide | Papel |
|---|---|---|---|
| Funil estratégico | `client_funnels` (nova) | Gestor, pelo painel | Agrupamento configurável — nunca uma lista fixa em código |
| Classificação campanha→funil | `campaign_funnel_assignments` (transformada) | Gestor, sempre manual | Fonte única do vínculo — sempre por `campaign_id`, nunca por nome |
| Meta de resultado | `client_goals` (intocada) | Gestor, já existente | Um funil PODE linkar opcionalmente (`linked_result_type`), nunca duplica o armazenamento |
| Objetivo técnico da Meta | `campaign_daily_metrics.result_type` / `metric_mappings` (intocados) | Sinal técnico automático | Auxiliar, nunca decide o funil sozinho |

Um funil é a estratégia do gestor; o objetivo técnico da Meta é só um sinal auxiliar; a meta de resultado é uma contagem de resultado configurada independentemente. As três coisas podem coincidir (funil "Vendas" linkado a `sales`, campanhas com `result_type = sales`) ou não (funil "Vendas" pode conter uma campanha cujo sinal técnico da Meta é `leads` — isso é esperado, o funil nunca reclassifica pelo sinal técnico).

## Modelo de dados

`supabase/client-funnels.sql` (não executado em produção nesta entrega — aguardando autorização):

- **`client_funnels`**: `id`, `client_id`, `name`, `naming_key` (chave reconhecida entre colchetes no nome da campanha, sempre maiúscula, única por cliente), `is_active`, `linked_result_type` (nullable, FK composta pra `client_goals(client_id, result_type)` — só linka a um objetivo que o cliente já tem configurado), `relevant_indicators` (subconjunto de `results`/`impressions`/`reach`/`clicks`, validado pela aplicação), `sort_order`.
- **`campaign_funnel_assignments`** (ex-`campaign_report_classifications`): `id`, `client_id`, `channel`, `campaign_id`, `funnel_id`, `assigned_by`, `confirmed_at`. Único por `(client_id, channel, campaign_id)`. Ausência de linha = pendente — nunca um valor "sem funil" gravado.

`supabase/media-granular-identifiers.sql` (também não executado): prepara colunas nullable de ID (`campaign_id`/`ad_set_id`/`ad_id`) em `ad_set_daily_metrics`/`ad_creative_daily_metrics`/`campaign_placement_daily_metrics` + colunas de configuração correspondentes em `import_sources` (`ad_set_id_column`/`ad_id_column`) — preparação de estrutura, não wiring: nenhuma extração Stract conhecida hoje fornece esses IDs, então o pipeline de escrita (`lib/import-sources.ts`/`lib/stract-sync.ts`) não foi alterado para popular essas colunas nesta entrega. Ver seção "Limitação assumida" abaixo.

## Sugestão, nunca classificação automática

`lib/client-funnels.ts` (núcleo puro): `suggestFunnelForCampaignName` procura, no nome da campanha, o texto `[chave]` (case-insensitive) de cada funil ATIVO do cliente. Três resultados possíveis — `matched` (uma chave, um funil), `no_key` (nenhuma reconhecida) e `ambiguous` (mais de um funil bate). Em nenhum dos três casos uma linha é gravada automaticamente: a UI (`funnels-section.tsx`, drawer "Classificar campanhas em funis") sempre exige confirmação explícita, individual (botão "Confirmar" por linha) ou em lote ("Confirmar todas as sugestões" — que só aplica sugestões `matched` de campanhas com `campaign_id` confiável, nunca uma ambígua ou sem chave).

Renomear uma campanha nunca altera uma classificação já confirmada (o vínculo é sempre por `campaign_id`). Mudar a `naming_key` de um funil nunca reclassifica campanhas já confirmadas (a sugestão só é recalculada pra campanhas ainda pendentes).

## Filtro por funil nas granularidades sem ID estável

`campaign_daily_metrics` é a única granularidade com `campaign_id` e `campaign_name` ao mesmo tempo. `ad_set_daily_metrics`/`ad_creative_daily_metrics`/`campaign_placement_daily_metrics` só têm nome. Pra filtrar essas três por funil, `buildFunnelByCampaignName` deriva um mapa nome→funil a partir das linhas de campanha do MESMO período: quando dois `campaign_id` diferentes resolvem pro mesmo nome com funis DIFERENTES no período (campanha excluída e recriada com o mesmo nome, por exemplo), o nome vira `"ambiguous"` — nunca escolhido arbitrariamente. `report-data.ts` expõe `funnelFilterMayBeIncomplete: true` quando isso acontece, e a Visão por Funil mostra um aviso explícito (nunca escondido) de que Públicos/Criativos/Posicionamentos podem estar incompletos para aquele funil especificamente — Campanhas continua sempre completo, porque é filtrado por ID.

## Integração com o Relatório

Substitui a Etapa anterior ("Resultados principais"/"Objetivos secundários", um toggle binário fixo) por um seletor real:

- **Visão geral** — sempre a conta inteira (nenhuma campanha excluída), com um painorama de investimento por funil (`funnelPanorama`) e um aviso de quantas campanhas do período ainda não têm funil confirmado (`pendingFunnelCampaignNames`).
- **Visão por funil** — uma campanha classificada por vez, pra qualquer funil que o gestor tenha criado (não mais uma lista fixa de 7 finalidades). Mostra só os indicadores que o gestor marcou como relevantes pra aquele funil (`relevant_indicators`) — "Resultados"/"Custo" só aparecem quando o funil tem `linked_result_type` configurado.

Isso é uma substituição funcional e compatível da Etapa anterior: um funil "Reconhecimento" com `relevant_indicators: ['impressions']` e sem meta vinculada reproduz exatamente o antigo "awareness"; um funil "Vendas" com `linked_result_type: 'sales'` reproduz o antigo "sales" — só que agora configurável pelo painel, nunca fixo em código. Cliente sem nenhum funil configurado nunca vê o seletor — Relatório idêntico ao de sempre.

Investimento nunca é duplicado (Visão geral sempre soma as linhas de campanha uma única vez; o painorama usa a mesma agregação); resultados de funis diferentes nunca são somados entre si (só investimento é comparável entre funis).

## Prioridade de identidade: ID sempre antes de nome

`lib/client-funnels.ts` expõe `resolveFunnelForRow`, usada por `report-data.ts` pra filtrar Públicos/Criativos/Posicionamentos por funil: quando a própria linha carrega `campaignId` (fonte com ID nessa granularidade — hoje, só o pipeline n8n/API oficial), ele é SEMPRE usado, nunca o nome. A ponte por nome (`buildFunnelByCampaignName`/`resolveFunnelForCampaignName`) só entra como fallback pra linhas sem `campaignId` (todo Stract hoje) — nunca tratada como um vínculo confiável, sempre sinalizada (`funnelFilterMayBeIncomplete`) quando usada. Campanhas em si (`campaign_daily_metrics`) sempre exigem `campaignId` pra entrar na Visão por Funil — nunca incluídas por nome.

## Pipeline n8n + API oficial da Meta — estado desta entrega

Decisão do usuário (com orientação do mentor): a extração passa a ser feita via n8n + API oficial da Meta, escrevendo ainda no Supabase/modelo interno da MITZA — nenhum workflow n8n foi construído nesta entrega (fica com o usuário/mentor), só o lado MITZA:

- **Migration** `supabase/meta-api-import-source.sql` (não executada) — `import_sources.provider` aceita `'meta_api'` além de `'stract'`; os 4 campos Stract-only (`table_name`/`account_id_column`/`date_column`/`spend_column`) viram nullable (só obrigatórios quando `provider = 'stract'`).
- **Núcleo puro** `lib/meta-api-ingest.ts` — valida o payload inteiro (todos os erros coletados, nunca só o primeiro) e converte pra `RawSourceRow`, o MESMO formato que `lib/import-sources.ts` já consome de qualquer fonte, com nomes de coluna FIXOS (o contrato é nosso, nunca configurável como no Stract).
- **Orquestração** `lib/meta-api-ingest-run.ts` — irmã de `runImportForSource` (`stract-sync.ts`): reaproveita as MESMAS funções de agregação/upsert (`lib/import-sources.ts`), o MESMO `metric_mappings`, o MESMO `data_sync_runs`. Nenhuma regra de negócio de relatório duplicada — o n8n nunca decide objetivo, nunca escreve numa tabela interna diretamente.
- **Endpoint** `POST /api/n8n/meta-insights` (`lib/n8n-auth.ts` pra autenticação — `Bearer <N8N_INGEST_SECRET>`, fail-closed, mesmo padrão de `lib/cron-auth.ts`) — contrato completo de campos/erros/teste em `docs/N8N_META_INGESTION_GUIDE.md`.
- **IDs granulares conectados**: diferente da entrega anterior (que só preparava as colunas sem popular), `lib/import-sources.ts` agora captura `campaign_id`/`ad_set_id`/`ad_id` nas agregações de ad set/criativo/posicionamento (não só campanha) — usado tanto pelo pipeline n8n (que sempre fornece) quanto, opcionalmente, por uma futura extração Stract que venha a configurar essas colunas (mesmo código, nunca dois caminhos).
- **Testes**: `scripts/test-meta-api-ingest.ts` (payload → flatten → agregação → resolução de objetivo → idempotência → prioridade de ID sobre nome, ponta a ponta sem precisar de Supabase real) + `scripts/test-client-funnels.ts` atualizado.

### O que ainda depende de uma ação humana antes de funcionar de verdade

1. Aprovar e rodar `supabase/meta-api-import-source.sql` (e as migrations anteriores de funis, se ainda não rodadas) em produção.
2. Configurar `N8N_INGEST_SECRET` como variável de ambiente do projeto (Vercel).
3. Registrar cada conta (`import_sources` + `metric_mappings`) antes do primeiro envio — nunca criado automaticamente a partir do payload (ver `docs/N8N_META_INGESTION_GUIDE.md`, seção 5).
4. Construir o workflow n8n em si (fora do escopo desta entrega).

Nenhum desses 4 pontos foi executado nesta sessão — só implementado e testado localmente, conforme pedido.
