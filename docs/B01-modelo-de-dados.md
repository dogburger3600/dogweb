# B01 — Modelo de dados e migrações

## Escopo e fonte de verdade disponível

Estas migrações foram projetadas a partir dos contratos observáveis no frontend aprovado em `cb678b63349853260ce2ab05765ccdda3a65f21b`. O repositório não continha migrations, dump do schema, configuração da Supabase CLI ou testes SQL. Portanto, a primeira migração é um *preflight* somente leitura que interrompe a execução quando as relações e colunas mínimas esperadas não existem.

O código comprova o uso de `products`, `orders`, `order_items`, `profiles`, `expenses`, `site_popup`, do bucket `product-images` e da RPC `place_order`. Ele não comprova tipos completos, constraints, triggers, funções nem políticas existentes.

## Ordem de execução

1. `20261019000100_b01_preflight.sql`: valida o contrato mínimo e não altera a base.
2. `20261019000200_b01_order_lifecycle.sql`: prepara cancelamento com justificativa e histórico de status sem mudar `orders.status`.
3. `20261019000300_b01_snack_stock.sql`: prepara histórico de unidades prontas, mantendo `products.stock` e `products.min_stock` como contrato existente.
4. `20261019000400_b01_store_settings.sql`: cria a configuração singleton com os valores comerciais aprovados, mas sem efeito automático no checkout.

As tabelas novas iniciam com RLS habilitada e sem políticas. Logo, não ficam acessíveis pelo cliente anônimo/autenticado até que uma fase de segurança crie políticas e operações server-side explícitas.

## Decisões e compatibilidade

- Cancelamentos ficam em `order_cancellations`, sem inventar agora um valor `cancelado` para `orders.status` e sem alterar a progressão existente.
- O histórico de status é append-only por conceito, mas nenhum trigger ou RPC foi criado nesta Task.
- Estoque continua representando somente lanches prontos. Não há ingredientes, reset diário, concorrência, débito ou restauração automática.
- `product_stock_movements` registra a intenção futura de auditoria; não atualiza `products.stock` sozinho.
- A configuração comercial é tipada e singleton. Os defaults de R$ 5,00 e R$ 15,00 são apenas dados; nenhuma regra de cálculo foi conectada.
- `site_popup.starts_at/ends_at`, `products.stock/min_stock` e o contrato de `place_order` já aparecem no frontend e não são redefinidos.
- `profiles.role` não é alterado. `owner` e `attendant` continuam apenas no mapa visual; autorização real depende do desenho de segurança posterior.
- Não foi criada uma view financeira. A regra autoritativa para pedidos cancelados/não realizados ainda precisa ser aprovada antes de alterar relatórios.

## Pré-validação obrigatória antes de qualquer aplicação futura

Em um projeto Supabase local vinculado a um dump sanitizado do schema real:

1. confirmar que `orders.id` e `products.id` aceitam referências `bigint` e que `profiles.id` é `uuid`;
2. executar todas as migrações dentro de uma transação em uma base descartável;
3. executar novamente a cadeia completa para validar reconstrução e o comportamento idempotente das instruções protegidas;
4. inspecionar conflitos de nomes de tabelas, índices e constraints;
5. criar e testar políticas RLS, funções/RPCs e autorização por ação em Task própria;
6. testar concorrência de estoque e cancelamento antes de conectar o frontend;
7. validar a regra financeira autoritativa antes de publicar qualquer consulta de relatório.

## Validação local realizada na B01

Em 19/10/2026, a cadeia foi executada em PostgreSQL 16.15 descartável, com um fixture mínimo que reproduz somente as relações, chaves e tipos observáveis no frontend:

- aplicação dos quatro arquivos em uma única transação: passou;
- segunda aplicação completa: passou, reutilizando tabelas/índices e sem duplicar o singleton;
- defaults comerciais e localização: passaram;
- constraints de singleton, justificativa de cancelamento, movimento de estoque e transição de status: passaram;
- RLS habilitada nas quatro tabelas novas e nenhuma política criada: confirmado;
- ausência de triggers automáticos em `orders` e `products`: confirmada;
- rejeição pelo preflight de uma base vazia/incompatível: confirmada.

Esse teste comprova a sintaxe e o comportamento no fixture, não a compatibilidade final com produção. A aplicação futura continua condicionada à comparação com um dump sanitizado do schema real.

## Recuperação e rollback

Estas migrations são aditivas e não substituem dados existentes. Se uma execução futura falhar, a transação deve ser revertida integralmente e o erro de preflight deve ser tratado antes de nova tentativa.

Se for necessário retirar a B01 após uso real, primeiro exporte os dados das tabelas novas. Em ordem inversa, remova políticas/dependências criadas por Tasks posteriores e só então considere:

```sql
drop table if exists public.store_settings;
drop table if exists public.product_stock_movements;
drop table if exists public.order_status_history;
drop table if exists public.order_cancellations;
```

Os comandos acima são deliberadamente destrutivos e **não** fazem parte das migrations automáticas. Não devem ser executados sem backup, janela de manutenção e confirmação de que nenhuma versão da aplicação depende dessas tabelas.

## Pendências deliberadas

- obter um dump sanitizado ou schema declarativo real para validar tipos e constraints;
- definir políticas RLS e autorização server-side para owner, manager e attendant;
- definir RPCs transacionais para transição/cancelamento de pedidos e movimentação de estoque;
- decidir se a restauração de estoque ocorre em cancelamentos e em quais estados;
- definir regra financeira de faturamento e exclusão de pedidos;
- integrar configurações da loja, agendamento público do popup e Realtime em Tasks próprias;
- definir retenção/auditoria para históricos e movimentos.

