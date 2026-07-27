# Integração Stract → Supabase → MITZA

## Objetivo da arquitetura

Criar uma camada de integração desacoplada entre provedores de mídia (inicialmente Stract/Meta Ads) e a plataforma MITZA, preservando a MITZA como única fonte de verdade para investimento, performance e indicadores calculados, permitindo evolução futura para Google Ads, TikTok Ads e outros provedores sem alterar a lógica de negócio.

## Contexto

A MITZA organiza investimento e resultado por Sprint (ciclo semanal dentro de cada mês, por cliente). Até esta etapa, investimento tinha uma sincronização direta com a API do Meta (sempre manual/sob demanda) e resultado era 100% lançamento manual. O Stract automatiza a extração de dados de mídia paga e grava direto no mesmo projeto Supabase da MITZA — esta integração conecta essa origem às tabelas internas da MITZA sem acoplar nenhuma parte operacional ao formato do Stract.

## Arquitetura implementada

1. **Como o Stract entrega os dados** — cria uma tabela própria por conta de anúncios conectada, dentro do schema `public`, com colunas dinâmicas conforme a métrica escolhida na extração (ex.: `insights_spend`, `actions_omni_purchase`, `insights_account_id`, `adhoc__daily`). `insights_account_id` vem no mesmo formato já usado pela MITZA (`act_...`), permitindo relacionamento direto por esse valor — nunca por nome de tabela ou nome de cliente.

2. **Camada de configuração** (nunca hardcoded no código):
   - `import_sources` — identidade da integração: cliente, conta (`act_...`), tabela física do Stract, e colunas compartilhadas por toda a fonte (conta, data, investimento).
   - `metric_mappings` — qual coluna representa cada objetivo (leads/vendas/seguidores), específico por objetivo já que o mesmo objetivo pode ter nomes de coluna diferentes conforme a extração configurada. Um objetivo pode ter **mais de uma** coluna ativa ao mesmo tempo (ex.: cliente de leads que roda campanha de formulário E campanha de WhatsApp/Messenger — métricas diferentes no Meta/Stract, mas o mesmo objetivo na MITZA) — o Import Service soma todas as colunas do mesmo objetivo por dia (`combineAggregatedDailyValues`) antes de gravar, nunca sobrescreve. Mudança de mapeamento desativa a linha antiga e cria uma nova (nunca `UPDATE` destrutivo — histórico preservado via `created_at`).

3. **Tabelas de destino**:
   - `daily_spend` — investimento diário, já existia, sem alteração de schema.
   - `daily_performance` — nova, espelha `daily_spend` pro lado de resultado, granularidade diária.
   - `data_sync_runs` — log de execução (sucesso/parcial/falha, linhas lidas/gravadas, erro).

4. **Import Service** (`src/lib/stract-sync.ts`) — lê a config, lê a tabela dinâmica via client sem o generic `Database` (nunca faz parte do contrato tipado interno), valida que o `account_id` da tabela bate com o configurado, agrega por dia (nunca assume 1 linha = 1 dia — o Stract pode gerar múltiplas linhas por dia conforme as dimensões da extração), grava via `upsert` idempotente, relendo o histórico inteiro configurado a cada execução (nunca usa cursor incremental).

5. **Custo por resultado nunca importado** — sempre recalculado internamente (investimento ÷ resultado), mesmo o Stract enviando uma coluna de custo já pronta.

6. **Coexistência com o fluxo manual** — cliente sem `import_sources` ativa continua lendo/lançando via `performance_records` (manual), sem nenhuma mudança de comportamento. Cliente com integração ativa lê de `daily_performance` — nunca os dois somados pro mesmo cliente.

7. **Cliente com integração ativa no canal Meta desativa a sincronização nativa antiga** (`src/lib/meta-sync.ts`) — evita duas fontes automáticas escrevendo a mesma chave `(client_id, date, channel)`.

## Decisões arquiteturais

- A MITZA nunca lê diretamente tabelas do Stract fora do Import Service.
- Dados externos nunca são consumidos diretamente pelo Dashboard, Sprint ou Relatórios — sempre via `daily_spend`/`daily_performance`.
- O Stract é tratado apenas como origem de dados — uma implementação substituível, nunca uma dependência estrutural. O nome da tabela física (`import_sources.table_name`) é só a localização atual, nunca uma chave de relacionamento.
- A MITZA continua sendo a única fonte de verdade dos cálculos.
- Indicadores derivados (CPA, CPL, ROAS futuro etc.) são sempre calculados internamente, nunca importados prontos.
- **O dado diário é permanente; Sprint é apenas uma forma de visualização.** Já valia implicitamente pra investimento (`daily_spend`) e foi estendido pra performance (`daily_performance`) nesta etapa — qualquer leitura futura por janela de tempo (últimos 7 dias, 30 dias, trimestre) pode ser construída em cima disso sem reprocessar nada. Uma Sprint sem dado não apaga o dado — só significa que não existe recorte pra exibi-lo (ver "Achado durante a validação" abaixo).
- Descoberta de schema (quais colunas existem numa tabela do Stract) só acontece manualmente, na configuração de uma `import_source` nova — o Import Service nunca faz introspecção em tempo de execução.

## Validação real feita

Validado com um cliente real, recém-cadastrado na plataforma, mas com histórico de meses anteriores à existência dele no sistema:

- 208 dias de histórico (janeiro a julho) importados com sucesso, investimento e vendas batendo com o Meta Ads real.
- Sincronização rodada duas vezes seguidas: mesmos 208 registros, sem duplicar nenhuma linha (idempotência confirmada).
- Custo por resultado calculado corretamente pela plataforma, nunca importado.
- `data_sync_runs` registrando cada execução com status e contagens corretas.
- Sincronização nativa antiga do Meta confirmada bloqueada para o cliente com integração ativa (nenhuma escrita nova em `daily_spend` ao tentar rodá-la manualmente).

### Achado durante a validação

Dados de meses anteriores à criação do cliente no sistema não apareciam em nenhuma tela, mesmo já gravados corretamente em `daily_spend`/`daily_performance` — porque a MITZA só exibe um mês se existir uma Sprint cadastrada pra aquele período, e Sprints nunca são geradas retroativamente por padrão. Resolvido reaproveitando a mesma função de cálculo de período já existente no banco (`compute_month_sprint_periods`), aplicada manualmente aos meses passados — sem gerar tarefas-checklist nem planejamento fictício pros meses retroativos (não fazia sentido criar pendência ou meta pra um período que já passou).

### Bug real encontrado e corrigido

O sistema de proteção de sessão da MITZA (`src/proxy.ts`) redirecionava, por engano, qualquer chamada sem cookie de sessão para `/login` — incluindo rotas de API chamadas por sistemas automáticos (cron, integrações), que nunca carregam sessão de navegador. Isso já afetava silenciosamente `/api/cron/sync-meta`, só nunca detectado porque aquele cron nunca tinha sido ativado de verdade. Corrigido excluindo `/api/*` da checagem de sessão — essas rotas já têm proteção própria (`CRON_SECRET`).

## Próximos passos

- Validar a integração por mais alguns dias utilizando apenas este cliente.
- Comparar diariamente os dados com o Meta Ads real.
- Expandir gradualmente para novos clientes.
- Ativar o cron automático (`/api/cron/sync-stract`, hoje criado mas não ligado em `vercel.json`) somente após estabilidade comprovada.
- Futuramente reutilizar a mesma arquitetura para Google Ads, TikTok Ads e outras integrações — o desenho já contempla isso (`provider`/`channel` como dimensões separadas), sem exigir mudança na lógica principal.

## Status

**Status atual: ✅ Implementado e validado.**

- Arquitetura implementada.
- Validação concluída com um cliente real, incluindo histórico retroativo completo.
- Cron automático ainda desabilitado por decisão de rollout.
- Expansão para novos clientes pendente de alguns dias de observação.
