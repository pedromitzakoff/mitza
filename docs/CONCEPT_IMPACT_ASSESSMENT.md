# Concept Impact Assessment — template

## Objetivo do documento

Template oficial de análise de impacto. Preenchido antes de qualquer
implementação que toque um conceito transversal (ver critérios em
`docs/HOW_WE_BUILD_FEATURES.md`, Seção 17) — nunca depois, e nunca
pulado por "a mudança parece pequena". Uma resposta em branco é um sinal
de que a auditoria daquela superfície ainda não foi feita, não um espaço
pra preencher com "n/a" por conveniência.

Não é um documento por feature guardado permanentemente — é preenchido
inline na proposta apresentada antes de implementar, e o resultado (o
que foi decidido) é o que eventualmente vira uma entrada em
`DECISIONS.md` se for constitucional o suficiente.

---

## Template

```
CONCEITO AFETADO
(nome oficial, conforme docs/PLATFORM_INTEGRITY.md Seção 3)

RESPONSABILIDADE
(uma frase — o que esse conceito representa)

FONTE DA VERDADE
(uma tabela/enum, ou explicar por que ainda há mais de uma)

TELAS AFETADAS
(lista completa — não só a tela onde o pedido chegou)

COMPONENTES AFETADOS
(lista completa)

SERVER ACTIONS
(lista completa + contrato: {error?} ou redirect, e por quê)

ESTADOS E ENUMS
(quais enums esse conceito usa; existe risco de colisão de valor com
outro domínio? ver src/lib/status-registry.ts)

PERMISSÕES
(Admin vs. Gestor — a diferença está refletida na UI E no servidor?)

TEXTOS E LABELS
(algum termo novo? já existe termo oficial pra isso em
docs/PLATFORM_INTEGRITY.md Seção 8?)

BADGES E CORES
(a representação já existe no status-registry? precisa de entrada nova?)

TOASTS E ERROS
(a mutação precisa de toast? as mensagens de erro são humanizadas?)

EMPTY STATES
(existe estado vazio pra esse fluxo? usa o componente oficial da família
visual da tela?)

MOTION E INTERACTION
(a mutação é reversível? nasce otimista? tem rollback?)

CONTEXT MEMORY
(a tela tem conteúdo expansível ou estado de navegação que precisa
sobreviver a uma ação?)

MOBILE
(testado em largura estreita e com teclado?)

RISCOS
(o que pode quebrar em outra tela que usa o mesmo conceito?)

TESTES
(lógica pura testada? UI validada manualmente?)

DECISÕES CONSTITUCIONAIS RELACIONADAS
(quais números de DECISIONS.md / seções de PLATFORM_INTEGRITY.md se
aplicam a esta mudança?)
```

## Quando usar

Sempre que a mudança pedida tocar um conceito que já aparece em mais de
uma tela, ou que já tenha um componente/Action/registry oficial
associado a ele. Para uma correção genuinamente local e isolada (um
texto errado numa única tela, um bug de cálculo isolado), o Assessment
completo é desnecessário — mas identificar o conceito e confirmar que
não há impacto global (`docs/HOW_WE_BUILD_FEATURES.md`, item 2) continua
obrigatório mesmo nesses casos.
