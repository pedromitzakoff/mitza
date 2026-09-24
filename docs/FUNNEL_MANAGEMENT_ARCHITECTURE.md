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

## Limitação assumida nesta entrega

As colunas de ID futuras (`ad_set_id`, `ad_id`, `campaign_id` nas granularidades que não tinham) foram **preparadas no schema** (nullable, sem afetar nenhum comportamento hoje) mas **não foram conectadas** ao pipeline de leitura/escrita (`lib/import-sources.ts`, `lib/stract-sync.ts`). Motivo: nenhuma extração Stract conhecida hoje expõe essas colunas — conectar agora seria trabalho morto sem uma fonte real pra popular. Quando o pipeline n8n + API oficial da Meta (próxima seção) estiver pronto, essas colunas já existem e só precisam ser preenchidas.

## Requisitos para o futuro pipeline n8n + API oficial da Meta

A extração via Stract será substituída no futuro por n8n + API oficial da Meta, inicialmente ainda escrevendo nas mesmas tabelas Supabase (nenhuma mudança de modelo interno nessa transição — só a origem dos dados muda). Para que os funis, o Relatório e a classificação por campanha funcionem com a mesma (ou melhor) confiabilidade que têm hoje, o pipeline futuro precisa fornecer:

### Identidade estável (obrigatório para igualar o nível de confiança atual)

- **`campaign_id`** em toda granularidade (campanha, conjunto de anúncios, criativo, posicionamento) — hoje só existe de forma confiável em `campaign_daily_metrics`. A API oficial da Meta expõe isso nativamente em qualquer nível (`campaign_id` está presente em todo relatório de insights, independente do `level` pedido).
- **`ad_set_id`** e **`ad_id`** — preparados no schema (`media-granular-identifiers.sql`) mas nunca populados hoje. A API oficial expõe os dois nativamente.
- Nomes (`campaign_name`, `ad_set_name`, `creative_name`/`ad_name`) continuam sendo capturados **em paralelo** aos IDs — nunca substituídos por eles. Nome é sempre a identidade de EXIBIÇÃO/sugestão (nunca de classificação); ID é sempre a identidade de classificação.

### Métricas

- `spend`, `impressions`, `reach`, `clicks` em toda granularidade que hoje já os tem (campanha, conjunto, criativo) — sem mudança de significado.
- Resultado por objetivo (leads/vendas/seguidores) na mesma granularidade de hoje (`metric_mappings` continua resolvendo qual ação da Meta corresponde a qual objetivo — isso não muda com a troca de pipeline).
- `platform_position` (posicionamento) já como uma dimensão de breakdown nativa da API oficial (`breakdowns=publisher_platform,platform_position` no Marketing API), preservando a granularidade que hoje só existe com `campaign_name` (sem ID) em `campaign_placement_daily_metrics`.

### Granularidade e cadência

- Diária, por `account_id`/`campaign_id` (mesmo grão de hoje) — nenhuma mudança na unidade de tempo que a MITZA já assume em todo o pipeline de agregação (`daily_spend`/`daily_performance`/`campaign_daily_metrics` etc.).
- Reimportação idempotente (upsert por chave natural, nunca duplicando linha) — mesma disciplina que `stract-sync.ts` já segue hoje.

### O que NÃO muda com a troca de pipeline

- O modelo de funis (`client_funnels`/`campaign_funnel_assignments`) é inteiramente independente do formato da fonte — foi desenhado deliberadamente pra não depender de nomes de coluna específicos do Stract (só de `campaign_id`, que qualquer fonte squarely precisa fornecer). Trocar a fonte não exige nenhuma migration nova no modelo de funis.
- A classificação campanha→funil já confirmada sobrevive à reimportação: o vínculo é por `campaign_id`, e o `campaign_id` de uma campanha real na Meta não muda ao trocar de pipeline de extração (é o identificador da plataforma, não um identificador interno da MITZA).
