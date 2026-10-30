# S01–S03 / H01 — Segurança e homologação

## Modelo de autorização

O servidor é a fonte de verdade. `ui-capabilities.js` controla somente apresentação.

| Capability | owner | manager | attendant | customer |
|---|---:|---:|---:|---:|
| Dashboard e pedidos operacionais | sim | sim | sim | não |
| Avançar estado de pedido | sim | sim | sim | não |
| Cancelar pedido | sim | sim | não | não |
| Relatórios, despesas, estoque, cardápio, popup e configurações | sim | sim | não | não |
| Auditoria operacional | sim | sim | não | não |
| Gestão de roles | sim | não | não | não |

`is_manager()` é mantida para compatibilidade com B01–B07 e passa a significar
explicitamente `owner` ou `manager`. A capability `advance_orders` é usada na
única operação administrativa liberada ao attendant.

## Ordem obrigatória de aplicação

1. `20261022000100_s01_extend_user_roles.sql`
2. Confirmar commit da primeira migration antes de continuar.
3. `20261022000200_s01_roles_and_capabilities.sql`
4. Validar roles, bootstrap, último owner e autoelevação.
5. `20261022000300_s02_rls_acl_hardening.sql`
6. Forçar reload do schema PostgREST, se necessário, e executar a matriz H01.

As migrations não foram aplicadas durante a implementação local.

## Controles implementados

- Enum ampliado isoladamente para evitar uso de valor novo na mesma transação.
- Bootstrap por UUID e e-mail exatos, abortando toda a migration em divergência.
- Atualização comum do profile recebe grants somente para dados pessoais; `role`
  não pode ser escrita diretamente por `authenticated`.
- Mudança de role somente por `set_user_role`, exclusivamente por owner.
- Advisory lock e lock de linha protegem concorrência e o último owner.
- O trigger histórico de cadastro é preservado; um guard independente força
  todo novo profile para `customer`, e metadata não define role.
- `products.cost` e `order_items.unit_cost` deixam de ter leitura direta pelos
  papéis da API. Custos administrativos são obtidos por RPC controlada.
- Storage público continua legível; escrita permanece owner/manager.
- Realtime de pedidos não é modificado.
- Login administrativo alternativo sem Turnstile foi removido; o acesso passa
  pelo fluxo central de login.
- Campos de produto e mensagens públicas foram protegidos contra injeção HTML;
  URLs de imagens aceitam somente HTTP/HTTPS.

## Recuperação

Antes de aplicar, exportar definições de functions, policies e ACLs afetadas.
Se o gate falhar, interromper antes da migration seguinte. A recuperação deve
restaurar as definições exportadas de policies/functions/ACLs. Valores de enum
PostgreSQL não são removidos de forma segura por rollback simples; manter os
valores não concede privilégios por si só. Não rebaixar o owner enquanto a nova
arquitetura estiver ativa.

## H01 — matriz pós-aplicação

| Caso | Resultado esperado |
|---|---|
| owner acessa todos os módulos e administra roles | permitido |
| manager opera e consulta auditoria, mas altera roles | negado |
| attendant lê/avança pedidos | permitido |
| attendant cancela, vê custos/relatórios/estoque | negado |
| customer lê catálogo e próprios pedidos | permitido |
| customer acessa painel/RPC administrativa | negado |
| update direto de `profiles.role` por qualquer usuário | negado |
| rebaixamento do último owner | negado |
| leitura REST de `products.cost` | negado |
| leitura REST de `order_items.unit_cost` | negado |
| escrita no bucket por attendant/customer/anon | negado |
| leitura pública de imagem do bucket | permitido |
| payload de produto contendo HTML/script | renderizado como texto |
| RPC administrativa por anon | negado |
| `place_order` por customer autenticado | preservado |
| eventos Realtime de pedidos autorizados por RLS | preservados |

Até a aplicação autorizada das migrations, os casos de runtime são `BLOCKED`.
