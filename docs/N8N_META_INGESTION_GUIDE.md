# Guia prático — ingestão n8n + API oficial da Meta

Guia de referência pra quem está construindo o workflow n8n (você + seu mentor). Cobre exatamente o que o n8n precisa buscar na Meta, em que formato enviar, pra onde, como autenticar, e como confirmar que a sincronização funcionou. A implementação do lado MITZA (validação, gravação, funis, Relatório) já está pronta e testada localmente — falta só registrar a conta e apontar o workflow n8n pra cá.

## Divisão de responsabilidade

| | n8n | MITZA |
|---|---|---|
| Autenticar na Meta Marketing API | ✅ | — |
| Buscar insights (spend, impressões, alcance, cliques, ações) | ✅ | — |
| Decidir QUAL `action_type` da Meta é "lead"/"venda" pro cliente | — | ✅ (`metric_mappings`) |
| Calcular CPA/ROAS/consolidar investimento por funil | — | ✅ (mesmo motor de sempre) |
| Classificar campanha em funil estratégico | — | ✅ (painel, sempre manual) |
| Decidir o que aparece no Relatório | — | ✅ |
| Guardar histórico de sincronização | — | ✅ (`data_sync_runs`) |

**Regra de ouro**: o n8n é um coletor — busca dado bruto na Meta e faz UM POST pra MITZA. Nunca decide objetivo, nunca escreve em tabela do Supabase diretamente, nunca calcula nada que hoje é responsabilidade do Relatório/funis. Se em algum momento parecer necessário o n8n "decidir" alguma coisa de negócio, é sinal de que essa regra deveria estar do lado MITZA — chame antes de implementar.

## 1. O que buscar na Meta Marketing API (Insights)

Endpoint de referência: `GET /v2X.0/act_<ID>/insights` (Graph API), com:

- **`level`**: rode a extração pelo menos no nível `ad` (o mais granular) — os níveis `campaign`/`adset` são deriváveis somando o nível `ad`, mas o inverso não é possível. Uma linha por `ad` × dia já contém `campaign_id`/`campaign_name`/`adset_id`/`adset_name`/`ad_id`/`ad_name` simultaneamente.
- **`time_increment`**: `1` (uma linha por dia — nunca agregado no intervalo inteiro).
- **`fields`** mínimos: `campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, reach, clicks, actions, action_values`.
- **`breakdowns`**: `publisher_platform,platform_position` quando quiser also alimentar Posicionamentos (opcional — sem isso, a seção "Posicionamentos" simplesmente não aparece pra essas linhas, sem erro).
- **`actions`/`action_values`**: vêm como array de `{action_type, value}` — o n8n deve transformar isso num objeto simples `{ "lead": 3, "purchase": 1 }` antes de enviar (ver seção 2). **Nunca decida aqui quais `action_type` "contam" como resultado** — mande todos os que vierem, a MITZA decide o resto via `metric_mappings`.

## 2. Formato do payload (contrato exato)

`POST` de um objeto JSON por conta de anúncios, por lote (pode ser 1 dia ou vários dias no mesmo POST):

```json
{
  "accountId": "act_123456789",
  "rows": [
    {
      "date": "2026-09-20",
      "campaignId": "120211000000001",
      "campaignName": "[CAPTACAO] | WhatsApp | Público aberto",
      "adSetId": "120211000000011",
      "adSetName": "Lookalike 1%",
      "adId": "120211000000111",
      "adName": "Vídeo depoimento",
      "platformPosition": "feed",
      "spend": 245.30,
      "impressions": 18452,
      "reach": 15200,
      "clicks": 312,
      "actions": { "lead": 4, "onsite_conversion.lead_grouped": 2 },
      "actionValues": {}
    }
  ]
}
```

### Campos obrigatórios (por linha)

| Campo | Tipo | Observação |
|---|---|---|
| `date` | string `YYYY-MM-DD` | Um dia civil |
| `campaignId` | string | **Sempre obrigatório** — nunca envie uma linha sem ID de campanha. É o que garante que o vínculo campanha→funil nunca dependa de correspondência por nome |
| `campaignName` | string | Só exibição/sugestão de funil — nunca usado como identidade |
| `spend` | number ≥ 0 | Investimento do dia, na moeda da conta |

### Campos opcionais (por linha)

| Campo | Tipo | Observação |
|---|---|---|
| `adSetId` + `adSetName` | string + string | **Sempre juntos** (um sem o outro é rejeitado). Sem eles, a seção "Públicos" do Relatório simplesmente não recebe dado desta linha — sem erro |
| `adId` + `adName` | string + string | Mesma regra, pra "Criativos" |
| `platformPosition` | string | Valor cru do `publisher_platform`/`platform_position` da Meta (ex.: `"feed"`, `"instagram_stories"`) — pra "Posicionamentos" |
| `impressions`, `reach`, `clicks` | number ≥ 0 | — |
| `actions` | objeto `{ action_type: contagem }` | Repasse bruto do que a Meta devolveu — nunca filtrado/decidido pelo n8n |
| `actionValues` | objeto `{ action_type: valor }` | Mesma chave de `actions`, valor monetário (só relevante pra `purchase`/vendas) |

Nenhum campo tem valor-default inventado: omitir um opcional é sempre "esta linha não tem esse dado", nunca vira 0/vazio silenciosamente.

## 3. Para onde enviar

```
POST https://<domínio-de-produção-da-mitza>/api/n8n/meta-insights
Content-Type: application/json
Authorization: Bearer <N8N_INGEST_SECRET>
```

Resposta de sucesso (`200`):
```json
{
  "ok": true,
  "runId": "uuid-da-execução",
  "status": "success",
  "rowsRead": 42,
  "spendRowsWritten": 1,
  "performanceRowsWritten": 1,
  "campaignRowsWritten": 3,
  "adSetRowsWritten": 8,
  "creativeRowsWritten": 12,
  "placementRowsWritten": 6,
  "note": null
}
```

Erros comuns:

| Status | Situação | Ação |
|---|---|---|
| `401` | Secret ausente/errado | Confira o header `Authorization` |
| `400` | Payload inválido | O corpo `details` lista TODOS os campos com problema, um por linha |
| `404` | `accountId` não registrado ainda | Peça pro time MITZA cadastrar a conta (seção 5) antes de reenviar |
| `409` | Fonte desativada, ou já tem uma sincronização rodando pra essa conta | Reative a fonte, ou aguarde e tente de novo |
| `429`/`503` | Limite de requisições / serviço de rate limit indisponível | Espere e tente de novo — o limite é generoso (30 req/min) pra uso normal |
| `500` | Falha interna ao gravar | Reenviar é seguro (idempotente) — se persistir, avise o time MITZA com o `runId` se algum veio na resposta |

## 4. Autenticação

Um único segredo compartilhado, `N8N_INGEST_SECRET` (variável de ambiente do projeto MITZA na Vercel — nunca commitada em lugar nenhum). O n8n guarda esse valor como credencial (ex.: um "HTTP Header Auth" no node de request) e sempre envia:

```
Authorization: Bearer <valor-do-N8N_INGEST_SECRET>
```

A comparação do lado MITZA é em tempo constante e falha fechado (sem a variável configurada no servidor, ou com o valor errado, a resposta é sempre `401` — nunca "deixa passar por engano"). Rotacionar o segredo é só trocar a variável de ambiente + atualizar a credencial no n8n, nenhuma mudança de código.

## 5. Pré-requisito único: registrar a conta (feito pelo time MITZA, uma vez por conta)

Antes do primeiro envio de uma conta, alguém do time MITZA precisa rodar em produção (depois de aprovar as migrations desta entrega, `supabase/meta-api-import-source.sql` e as anteriores):

```sql
insert into import_sources (client_id, provider, channel, external_account_id, enabled)
values ('<uuid-do-cliente-na-mitza>', 'meta_api', 'meta', 'act_123456789', true);

-- Objetivo "leads" somando os action_type que valem pra este cliente:
insert into metric_mappings (import_source_id, goal, result_column, active)
select id, 'leads', 'actions.lead', true from import_sources
where external_account_id = 'act_123456789' and provider = 'meta_api';

insert into metric_mappings (import_source_id, goal, result_column, active)
select id, 'leads', 'actions.onsite_conversion.lead_grouped', true from import_sources
where external_account_id = 'act_123456789' and provider = 'meta_api';

-- Objetivo "vendas" (com receita, se a conta rastrear valor de conversão):
insert into metric_mappings (import_source_id, goal, result_column, value_column, active)
select id, 'sales', 'actions.purchase', 'actionValues.purchase', true from import_sources
where external_account_id = 'act_123456789' and provider = 'meta_api';
```

`result_column`/`value_column` usam sempre o prefixo `actions.`/`actionValues.` seguido do `action_type` exato que a Meta devolveu naquele payload (confira o valor real recebido — `action_type` varia por tipo de campanha/pixel configurado, nunca adivinhe). Sem essa linha em `metric_mappings`, o investimento/campanhas/públicos/criativos continuam sendo gravados normalmente — só o resultado (leads/vendas) não aparece até o mapeamento existir, exatamente como já funciona pro Stract hoje.

## 6. Como testar

**Sem tocar dado real** — teste primeiro contra um ambiente local (`npm run dev`) apontando pro seu próprio Supabase de desenvolvimento, com uma conta de teste registrada como acima.

1. Confirme autenticação: um POST sem `Authorization` (ou com o secret errado) deve devolver `401`.
2. Envie um payload pequeno (1-2 linhas, 1 dia, dados fictícios) e confira a resposta `200` com as contagens (`rowsRead`, `campaignRowsWritten` etc.) batendo com o que você enviou.
3. Reenvie o MESMO payload — a resposta deve ser idêntica (mesmas contagens), nunca duplicar linha (upsert idempotente pela mesma chave natural).
4. No painel MITZA, abra o cliente de teste → Funis → confirme que a campanha aparece na lista de classificação pendente (com sugestão, se o nome tiver a chave `[FUNIL]`).
5. Classifique a campanha num funil e confira o Relatório → Visão por funil mostrando o investimento/indicadores certos.
6. Rode a extração real (dados de produção da Meta) só depois disso passar, e só pro cliente piloto (seção abaixo) — nunca em massa na primeira tentativa.

## 7. Sequência recomendada com um cliente piloto

1. Registrar a conta do cliente piloto (`import_sources` + `metric_mappings`, seção 5) — sem desativar o Stract dele, se já tiver.
2. Rodar o workflow n8n só pra essa conta, só pro período mais recente (últimos 3-7 dias) — nunca um backfill histórico grande na primeira tentativa.
3. Comparar, pro mesmo período: investimento total no Relatório MITZA (Visão geral) vs. Gerenciador de Anúncios da Meta; e, se o cliente também tiver Stract ativo, comparar os dois números entre si (devem bater, mesma fonte real, dois caminhos de extração).
4. Confirmar no Relatório → Campanhas que toda campanha do piloto aparece com `campaignId` (nenhuma linha "sem ID" — diferente do Stract, que raramente tem isso configurado).
5. Criar 1-2 funis reais pro cliente piloto, classificar as campanhas (usando a sugestão por chave quando o nome já seguir a convenção `[CHAVE]`), e conferir a Visão por Funil.
6. Só depois de validar um ciclo completo (investimento batendo, funis funcionando, sem erro em `data_sync_runs`) expandir o workflow n8n pra mais contas — uma de cada vez, no mesmo ritmo.
7. A decisão de desativar o Stract de um cliente específico (pra evitar sincronização duplicada) só deve acontecer depois do n8n estar confirmadamente estável pra aquele cliente — nunca antes, e é sempre uma ação explícita, nunca automática.

## O que fica de fora desta entrega (limitações assumidas)

- **Nenhum workflow n8n foi criado** — só o lado MITZA (endpoint, validação, gravação). A construção do workflow em si é com você e seu mentor.
- **Segredo único, não por conta** — `N8N_INGEST_SECRET` autentica o canal inteiro, não uma conta específica. Suficiente pra uma automação interna; evoluir pra um token por conta não exige mudança de schema (é só um campo novo em `import_sources`), mas não foi implementado agora.
- **Sem backfill orquestrado pela MITZA** — reprocessar um histórico grande é responsabilidade do workflow n8n decidir como paginar/enviar (a MITZA aceita qualquer intervalo de datas no mesmo payload, sem limite arbitrário de linhas por requisição, mas não orquestra chamadas à API da Meta).
- **`Idade`/`Gênero`/outras dimensões demográficas** não fazem parte do contrato desta entrega — fora do escopo pedido.
