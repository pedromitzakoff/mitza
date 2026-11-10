/**
 * Flags de migração pendente — "código já publicado, banco de produção
 * ainda não aplicou a migração correspondente". Nunca um feature flag de
 * produto (não controla o que o usuário VÊ, só qual caminho de ESCRITA o
 * código usa) — existe só pra permitir publicar a interface nova sem
 * depender de rodar SQL em produção ao mesmo tempo (Etapa "Configuração
 * inteligente de métricas por cliente", pedido explícito do usuário:
 * "separe a publicação visual das alterações de banco, de forma segura").
 *
 * Cada flag vira `false` → `true` (nunca o contrário) assim que a migração
 * SQL correspondente rodar em produção — essa é a ÚNICA mudança de código
 * necessária pra ativar o caminho novo; o caminho antigo (fallback) nunca é
 * removido do arquivo por esta etapa (continua existindo, só deixa de ser
 * chamado).
 */

/**
 * `supabase/client-goal-primary-consistency.sql` (a função
 * `set_client_primary_performance_goal`, que escreve `clients.
 * performance_goal` e `client_goals.is_primary` na mesma transação) ainda
 * NÃO rodou em produção. Enquanto `false`, `setClientGoalPrimaryAction`/
 * `updateClientPerformanceGoalAction` usam o comportamento ANTERIOR (duas
 * gravações separadas, não atômico — o mesmo que já rodava em produção
 * antes desta etapa, nunca reportado como quebrado). Mude pra `true` assim
 * que a migração acima for executada.
 */
export const PRIMARY_GOAL_CONSISTENCY_RPC_MIGRATED = false;
