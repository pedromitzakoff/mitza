# Platform Workspace Consistency — Wave 3

## Objetivo do documento

Registro da etapa "MITZA Platform Integrity Wave 3": Sprint foi declarada
o **Golden Standard** da plataforma (Interaction Engine, Context Memory,
Platform Feel, Motion, Cognitive Load, Confiança — todos já maduros ali).
Esta etapa audita as demais entidades/workspaces contra esse padrão e
consolida só onde reaproveitar é seguro e de baixo risco. Complementa
`PLATFORM_INTEGRITY.md` (consistência conceitual) e `PLATFORM_FEEL.md`
(percepção) — este documento é especificamente sobre PARIDADE entre
módulos.

---

## PARTE 1 — Entity Audit (nota 0–10 por critério)

| Entidade | Interaction Engine | Context Memory | Toast | Optimistic/Rollback | Permission | Motion | Status Registry | Empty State | Tooltip | Server Action | DX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Tarefa** | 10 | 10 (Sprints) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| **Comentário** | 9 | 8 | 10 | 6 (sem optimistic append) | 10 | 10 | N/A | N/A | N/A | 10 | 9 |
| **Performance/Objetivo** | 8 | 6 | 9 | 8 | 10 | 10 | 10 | N/A | 10 | 8 | 9 |
| **Equipe** | 8 (era 4) | 3 | 9 (era 6) | 7 (era 3) | 10 | 8 | 10 | 8 | 3 | 8 (era 5) | 8 (era 6) |
| **Cliente** | 4 | 3 | 5 | 3 | 10 | 8 | 10 | 8 | 3 | 5 | 6 |
| **Revisão de Conta** | 2 | 3 | 3 | 1 | 10 | 8 | 8 | 8 | 2 | 3 | 5 |
| **Relatórios** | 2 | 3 | 3 | 1 | 10 | 7 | 9 | 6 | 2 | 2 | 5 |
| **Configurações** | 5 | 3 | 6 | 4 | 10 | 8 | 9 | 7 | 2 | 6 | 7 |

**Ordem de maturidade (maior → menor)**: Tarefa → Comentário →
Performance/Objetivo → Equipe (depois desta Wave) → Configurações →
Cliente → Relatórios ≈ Revisão de Conta.

---

## PARTE 2 — Workspace Consistency (comparado direto com Sprint)

| Pergunta | Resposta |
|---|---|
| O que a Sprint tem que falta no resto? | Chamada direta de Server Action (sem `<form action>` cru), toast em toda mutação, rollback automático via `useOptimistic`, Context Memory de expansão/scroll. |
| Comportamentos ainda do "sistema antigo"? | `redirect()`+query-param de erro em: criar/editar tarefa (página cheia), criar/editar/excluir cliente, registrar revisão de conta, cadência de revisão, todas as 13 Actions de Relatórios, templates de sprint. |
| Contratos diferentes na mesma entidade? | Equipe tinha 3 contratos coexistindo (resolvido nesta Wave para desativar/reativar — ver Parte 5). |
| Feedbacks inconsistentes? | Onde ainda existe `redirect()`+banner de erro, o texto passou por `toUserFacingError` (Wave 2), mas a EXPERIÊNCIA continua sendo "esperar a página recarregar", não um toast — divergência de ritmo, não de clareza da mensagem. |
| Componentes isolados? | `DeactivateMemberButton` (removido nesta Wave — reaproveitava mal o que `ToastActionButton` já fazia). |

**Ordenado por impacto percebido**: (1) Criar/editar tarefa e cliente via página cheia — os fluxos mais frequentes ainda fora do Interaction Engine; (2) Registrar revisão de conta — mesma classe de problema, menos frequente; (3) Relatórios — 100% do sistema antigo, mas uso é mensal/pontual (menor frequência amortece o impacto); (4) Equipe — resolvido nesta Wave.

---

## PARTE 3 — Client Workspace (auditado, não alterado nesta Wave)

Cadastro/edição/exclusão continuam com o formulário completo (`client-form.tsx`) — decisão já registrada em `PLATFORM_INTEGRITY.md` (criação de registro complexo pode permanecer servidor-primeiro). Status/Gestor/Contrato/Mensalidade via Configurações>Clientes já são otimistas com toast (Wave 1 Interaction Engine). O Drawer de detalhe do cliente não tem Context Memory (só Sprints tem hoje) — auditado na Parte 8, não implementado por falta de conteúdo expansível multi-instância genuíno (só um `<details>` de histórico, deliberadamente sempre fechado por decisão já documentada em `collapsible-account-history.tsx`).

## PARTE 4 — Account Review Workspace (auditado, não alterado nesta Wave)

Registrar revisão e cadência continuam 100% redirect-based. Nenhum comportamento legado NOVO foi encontrado (o que existe já estava mapeado nas Waves anteriores) — migrar exigiria o mesmo tipo de extração de client component feita para Comentário/Tarefa na Wave 2, mas o formulário de registro tem mais campos e validações — maior risco pra uma consolidação de baixo risco. Candidata explícita de Wave 4.

## PARTE 5 — Team Workspace (auditado E consolidado nesta Wave)

**Antes**: 3 contratos coexistindo — `createTeamMemberAction`/`deleteTeamMemberAction` sempre `redirect()`; `updateTeamMemberAction`/`deactivateTeamMemberAction`/`reactivateTeamMemberAction` `redirect()` só no erro; `inviteTeamMemberAction`/`resendInviteAction`/`revokeAccessAction` já `{error?/message?}` limpos, via `ToastActionButton`.

**Depois**: `deactivateTeamMemberAction`/`reactivateTeamMemberAction` migradas pro mesmo contrato `{error?/message?}` + `ToastActionButton` — exatamente o componente que `resendInviteAction` já usava (reuso direto, zero componente novo). O parâmetro `editId` (que só existia pra escolher a URL de redirect) deixou de fazer sentido sem redirect e foi removido. O wrapper redundante `DeactivateMemberButton` foi eliminado (fazia a mesma coisa que `ToastActionButton`, pior).

**Ainda pendente** (não implementado): `createTeamMemberAction`/`updateTeamMemberAction`/`deleteTeamMemberAction` continuam com página/drawer cheio + redirect — mesma classe de risco de Cliente/Tarefa (criação/edição multi-campo), fora do escopo de "baixo risco" desta Wave.

## PARTE 6 — Reports Workspace (auditado, não alterado nesta Wave)

Nenhuma das 13 Actions foi tocada — confirmado como o workspace mais distante do padrão Sprint (redirect em 100% dos casos, nenhum toast, nenhuma otimização). Migrar exigiria reestruturar uma tela inteira de formulário sequencial — decisão explícita de **não** fazer isso numa etapa de "baixo risco". Maior candidata única de Wave 4.

---

## PARTE 7 — Complete Interaction Engine (expansão real desta Wave)

Adicionado: desativar/reativar membro de equipe (Equipe). Confirmado sem mudança: concluir/excluir tarefa, comentar, editar objetivo/campos inline, convidar/reenviar convite/revogar acesso (já cobertos em Waves anteriores). Não expandido (documentado como Wave 4): criar/editar/excluir cliente, criar/editar tarefa completo, criar/editar/desativar membro, registrar revisão de conta, todas as Actions de Relatórios.

## PARTE 8 — Complete Context Memory (auditado, não expandido)

Verificado onde existe conteúdo expansível MÚLTIPLO e persistente o suficiente pra justificar memória entre navegações (o padrão real de Sprints: vários clientes/sprints/comentários abertos ao mesmo tempo): nenhuma outra tela tem esse padrão hoje. Cliente tem só um `<details>` de histórico (deliberadamente sempre fechado por decisão já registrada). Equipe e Relatórios não têm accordions de conteúdo — só um menu de ações (`<details>` como popover, que não deve lembrar estado). **Conclusão honesta**: expandir Context Memory pra essas telas hoje seria inventar um problema que não existe, não resolver um real — mantido como está, revisado novamente se/quando alguma dessas telas ganhar conteúdo expansível de verdade.

## PARTE 9 — Workspace Feel

Depois desta Wave, Equipe deixa de ser a entidade com o contrato mais inconsistente da plataforma — os toggles mais comuns (desativar/reativar) agora respondem exatamente como concluir/excluir tarefa. Cliente, Revisão de Conta e Relatórios ainda "parecem de outro sistema" nos fluxos de criar/editar completos — não por falta de qualidade, mas por ainda dependerem de navegação de página inteira onde o resto da plataforma já não depende mais. Nenhuma nova inconsistência foi introduzida.

## PARTE 10 — Platform Consistency Score

| Área | Nota |
|---|---|
| Sprint | 10 |
| Tarefa (dentro de Sprint) | 10 |
| Equipe | 8 (era 6) |
| Configurações | 7 |
| Visão Geral | 8 |
| Sidebar | 9 |
| Drawers | 8 |
| Cliente | 7 |
| Revisões de Conta | 6 |
| Relatórios | 6 |
| Interaction (geral) | 8 (era 7) |
| Platform Feel (geral) | 7,5 (Feel 1.0) |
| Consistency (geral) | 8 (era 7) |

**O que falta para todas atingirem 10**: migrar Cliente/Revisão de
Conta/Relatórios/criação de Equipe pro contrato `{error?}` sem redirect de
erro, com chamada direta + toast (mesmo padrão já usado em Tarefa/
Comentário/Equipe-toggle) — cada uma é uma etapa própria de médio risco
(exige extrair client components de formulários maiores), não uma
consolidação de baixo risco como esta Wave permitia.

---

## Recomendações para Wave 4

1. Migrar Relatórios (13 Actions) — maior ganho isolado, maior risco.
2. Migrar criar/editar tarefa (página completa) pro Interaction Engine.
3. Migrar registrar revisão de conta.
4. Migrar criar/editar cliente e criar/editar/excluir membro de equipe.
5. Reavaliar Context Memory em Cliente/Relatórios SE alguma dessas telas
   ganhar conteúdo expansível múltiplo de verdade no futuro.
