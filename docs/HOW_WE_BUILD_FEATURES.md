# Como construímos features na Mitza

## Objetivo do documento

Manual operacional curto — pra qualquer desenvolvedor ou assistente de
IA saber, em minutos, o que verificar antes de tocar em qualquer conceito
já existente na plataforma. Não repete a Constituição
(`docs/PLATFORM_INTEGRITY.md`) — transforma ela em checklist prático.

Se a resposta a alguma pergunta abaixo for "não sei" ou "existe mais de
uma", isso é o sinal de parar e propor impacto global (ver Concept Impact
Assessment, `docs/CONCEPT_IMPACT_ASSESSMENT.md`) antes de escrever
qualquer código.

---

## 1. Antes de codar

Qual conceito oficial (`docs/PLATFORM_INTEGRITY.md`, Seção 3) esta
mudança afeta? Se não existir na lista, ela pode estar introduzindo um
conceito novo — trate como transversal, não como ajuste local.

## 2. Impacto do conceito

Onde mais esse conceito aparece na plataforma além da tela em que o
pedido foi feito? **Nunca altere apenas a tela onde o problema foi
observado sem antes verificar se o conceito aparece em outros lugares.**

## 3. Fonte da verdade

Existe uma fonte única de dado pra esse conceito (`docs/
PLATFORM_INTEGRITY.md`, Seção 4)? Se a mudança cria uma segunda fonte
(uma cópia, um cache paralelo, um cálculo duplicado), pare.

## 4. Reutilização

Existe componente, hook, Server Action ou registry oficial pra isso? Um
componente parecido não é motivo pra criar um novo — é motivo pra
verificar se o oficial já resolve, e propor extensão dele se não
resolver.

## 5. Server Action

Contrato único: `{error?: string}` + `revalidatePath`. `redirect()` só
quando a ação genuinamente termina em navegação pra outra tela — nunca
pra sinalizar erro.

## 6. Optimistic UI

A mutação é reversível e o dado já está na tela? Então ela nasce
otimista (`useOptimisticList`/padrão do Interaction Engine), não depois.

## 7. Rollback

Toda atualização otimista tem reconciliação e desfazimento automático em
caso de erro — sem exceção.

## 8. Toast

Erro em ação otimista: toast obrigatório (a única forma de o usuário
saber que algo foi desfeito). Sucesso: toast quando o resultado não é
autoexplicativo visualmente.

## 9. Context Memory

A tela tem conteúdo expansível (accordion, `<details>`) ou estado que se
perde ao navegar? Instancie `useScreenMemory` — não é opcional pra telas
novas.

## 10. Permissões

A ação é restrita a Admin? Ela precisa estar ausente (ou desabilitada
com motivo visível) na UI pra quem não pode — nunca clicável-e-falha-no-
servidor. E precisa estar bloqueada no servidor independentemente do que
a UI faz.

## 11. Empty State

Use `EmptyState`/`EmptyStateRow` da família visual da tela (`ui/` ou
`workspace/`, ver `docs/PLATFORM_INTEGRITY.md` Seção 9) — nunca um `<p>`
ou `<div>` de texto solto escrito à mão.

## 12. Loading e erro

Toda espera perceptível tem estado de loading explícito. Toda mensagem
de erro é humanizada — nunca a mensagem crua do banco/API repassada pro
usuário.

## 13. Linguagem

Consulte o vocabulário oficial (`docs/PLATFORM_INTEGRITY.md`, Seção 8)
antes de escrever um texto novo pra um conceito que já tem nome definido.

## 14. Mobile e acessibilidade

Testado com teclado (foco visível, Tab/Esc funcionam)? Testado em
largura estreita? `prefers-reduced-motion` respeitado em qualquer
animação nova?

## 15. Testes

Lógica pura (cálculo, classificação de status, formatação) ganha teste
unitário. UI é validada manualmente (golden path + casos de borda) antes
de reportar como concluído.

## 16. Relatório final

`lint` + `tsc --noEmit` + `build` limpos antes de apresentar qualquer
implementação como pronta. Nunca commit automático sem essa validação.

## 17. Critérios para não implementar

Pare e proponha em vez de implementar quando: a mudança tocaria mais de
uma superfície de edição do mesmo conceito; o pedido implica mudança de
regra de negócio disfarçada de ajuste visual; não existe consenso sobre
qual dos dois padrões concorrentes vira o oficial; ou a mudança exigiria
alterar contrato de Server Action fora do escopo pedido.

---

## Checklist obrigatório

```
[ ] Qual conceito está sendo alterado?
[ ] Onde ele aparece?
[ ] Existe uma fonte da verdade oficial?
[ ] Existe componente oficial?
[ ] Existe Action oficial?
[ ] Existe registry oficial?
[ ] O comportamento será globalmente consistente?
[ ] Precisa de optimistic UI?
[ ] Existe rollback?
[ ] Precisa de toast?
[ ] Context Memory deve ser preservado?
[ ] Permissões estão refletidas na UI e no servidor?
[ ] Existe estado vazio?
[ ] Existe loading?
[ ] Mensagens de erro são humanizadas?
[ ] Mobile e teclado foram validados?
[ ] Todas as superfícies impactadas foram verificadas?
```

## Guardrails para assistentes de IA

- Não criar componente semelhante sem procurar o oficial primeiro.
- Não criar enum, label ou badge local sem consultar `status-registry.ts`.
- Não criar Server Action nova sem seguir o contrato oficial (Seção 5).
- Não usar `redirect()` para sinalizar erro.
- Não exibir erro técnico cru.
- Não criar empty state manual — usar o componente da família visual da tela.
- Não criar popover/drawer ad-hoc — usar `FloatingPortalPanel`.
- Não alterar um conceito sem mapear todas as superfícies onde ele aparece.
- Não generalizar prematuramente sem um segundo uso real já existente.
- Não implementar uma recomendação futura (roadmap, "candidato") sem
  aprovação explícita — recomendação não é aprovação.
- Sempre diferenciar, na comunicação com quem pediu a mudança: o que foi
  **auditado como fato**, o que foi **decidido e aprovado**, e o que é
  **hipótese ou sugestão** — nunca apresentar uma hipótese como se já
  fosse uma decisão tomada.

## Fluxo obrigatório pra mudanças transversais

Nenhuma feature transversal é implementada diretamente após o pedido:

1. Concept Impact Assessment (`docs/CONCEPT_IMPACT_ASSESSMENT.md`).
2. Auditoria das superfícies onde o conceito aparece.
3. Proposta (opções, trade-offs, se houver).
4. Aprovação de quem pediu.
5. Implementação.
6. Validação global (todas as superfícies impactadas, não só a original).
7. Atualização de `docs/PLATFORM_INTEGRITY.md`/`DECISIONS.md` se necessário.
8. Relatório final.

Para mudanças locais de baixo risco, os passos 1-4 ainda existem, só que
mais rápidos: identifique o conceito, confirme que não há impacto
global, e só então implemente.
