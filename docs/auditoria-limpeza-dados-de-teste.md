# Auditoria para limpeza dos dados de teste

## Escopo e conclusão

Esta auditoria foi feita exclusivamente sobre o esquema versionado no repositório. Nenhuma consulta foi enviada ao Supabase e nenhum dado foi removido.

A definição inicial de seis tabelas não cobre todo o estado operacional. O repositório também identifica `public.operational_audit_log`, `public.expenses`, `public.site_popup`, `public.store_settings`, `public.role_change_audit_log` e arquivos no bucket `product-images`. Somente os eventos de auditoria ligados a `order` e `product` foram incluídos na proposta de limpeza. Despesas, configurações, auditoria de papéis e Storage permanecem preservados até autorização específica.

O esquema original de `products`, `orders`, `order_items`, `profiles`, `expenses` e `site_popup` não está versionado integralmente: a migration B01 apenas verifica a existência dessas relações. Por isso, a auditoria do banco real com [`test-data-read-only-audit.sql`](../supabase/audits/test-data-read-only-audit.sql) é um pré-requisito obrigatório.

## Inventário comprovado

| Relação | Papel | Tratamento proposto |
| --- | --- | --- |
| `products` | Catálogo, preço, custo, disponibilidade e saldo | Limpar após filhos |
| `orders` | Cabeçalho e snapshots financeiros do pedido | Limpar após filhos |
| `order_items` | Itens e snapshots de nome, preço e custo | Limpar antes de pedidos/produtos |
| `product_stock_movements` | Trilha de débito, reposição e restauração | Limpar antes de pedidos/produtos |
| `order_cancellations` | Justificativas de cancelamento | Limpar antes de pedidos |
| `order_status_history` | Histórico de transições | Limpar antes de pedidos |
| `operational_audit_log` | Eventos administrativos append-only | Limpar apenas eventos `order`/`product` |
| `expenses` | Dados financeiros operacionais | Preservar; exige autorização separada |
| `site_popup` | Configuração promocional pública | Preservar |
| `store_settings` | Horários, entrega, pagamentos e dados da loja | Preservar |
| `profiles`, `auth.users` | Identidade, autenticação e perfis | Preservar e validar contagens |
| `role_change_audit_log` | Auditoria administrativa de papéis | Preservar |
| `storage.objects` / `product-images` | Arquivos de imagens | Inventariar; eventual remoção via Storage API |

## Dependências comprovadas nas migrations

- `product_stock_movements.product_id -> products.id` usa `ON DELETE RESTRICT`.
- `product_stock_movements.order_id -> orders.id` usa `ON DELETE RESTRICT`.
- `product_stock_movements.created_by -> profiles.id` usa `ON DELETE SET NULL`.
- `order_cancellations.order_id -> orders.id` usa `ON DELETE RESTRICT`.
- `order_cancellations.cancelled_by -> profiles.id` usa `ON DELETE RESTRICT`.
- `order_status_history.order_id -> orders.id` usa `ON DELETE CASCADE`.
- `order_status_history.changed_by -> profiles.id` usa `ON DELETE SET NULL`.
- `store_settings.updated_by -> profiles.id` usa `ON DELETE SET NULL`.
- `operational_audit_log` referencia ator e entidade por valores, sem FK declarada.

As FKs originais de `order_items`, `orders` e `products` precisam ser confirmadas no banco real. O script definitivo interrompe se encontrar uma tabela externa apontando para `orders` ou `products`.

## Funções e efeitos indiretos

As RPCs `place_order`, `transition_order_status`, `cancel_order`, `restock_snack_product` e `set_snack_min_stock` leem ou escrevem pedidos, produtos, históricos e movimentos. `get_manager_report`, `get_admin_products`, `get_admin_order_costs`, `get_operational_cancellation_flags` e `get_operational_audit` leem esses dados.

`place_order` bloqueia produtos, cria pedido e itens, reduz o estoque e registra movimentos. `cancel_order` pode restaurar estoque e registrar auditoria. A limpeza deve ocorrer em janela de manutenção sem pedidos abertos ou novas gravações.

Não foram encontrados triggers de exclusão definidos pelas migrations versionadas. O banco legado pode ter triggers adicionais; a proposta falha se detectar trigger de usuário para `DELETE` ou `TRUNCATE` nas tabelas do escopo.

## RLS, ACL e exclusão individual

Produtos ativos são públicos. Owner e manager podem ler o catálogo completo e atualizar produtos por `has_capability('manage_menu')`. Não há política nem grant de `DELETE` para `products`. A movimentação de estoque também restringe a exclusão física do produto.

Assim, a funcionalidade individual usa exclusão lógica (`active = false`). Isso remove o item do cardápio público, conserva pedidos, snapshots financeiros e movimentos, e deixa a autorização real a cargo da policy de `UPDATE` do Supabase.

## Sequências e identificadores

O repositório identifica as sequências `products_id_seq`, `orders_id_seq`, `order_items_id_seq`, `product_stock_movements_id_seq`, `order_status_history_id_seq`, `operational_audit_log_id_seq` e `expenses_id_seq`. Os pedidos são exibidos no frontend como `PED-` seguido do ID numérico preenchido com zeros.

A proposta não reinicia sequências. Reutilizar IDs pode confundir logs externos, screenshots, integrações e referências textuais de auditoria. Se o proprietário exigir começar em 1, isso deve ser uma decisão separada, posterior à confirmação de que não existem referências fora do banco.

## Revisão do SQL anterior

- `ACCESS EXCLUSIVE` bloqueia também leituras e pode causar indisponibilidade desnecessária. A proposta usa `SHARE ROW EXCLUSIVE`, que impede gravações concorrentes e mantém leituras.
- `lock_timeout` reduz espera, mas não substitui uma janela de manutenção; uma falha de lock deve abortar, nunca ser contornada.
- A lista inicial omitia auditoria operacional, despesas, promoções, Storage e possíveis relações legadas.
- A ordem de exclusão precisa respeitar todos os `RESTRICT`, não apenas os filhos conhecidos.
- Triggers não auditados podem produzir novos registros ou efeitos externos.
- Validar apenas as seis tabelas não detecta mudanças em usuários/perfis nem resíduos de auditoria.
- `BEGIN`/`COMMIT` garante rollback em erro, mas um `COMMIT` bem-sucedido exige backup para recuperação posterior.
- Reiniciar sequências não é necessário para “zerar” o aplicativo e aumenta o risco de colisão conceitual.
- Bloqueios não impedem integrações externas de tentar gravar; elas receberão espera/erro durante a manutenção.

## SQL proposto

O arquivo [`test-data-cleanup-proposal.sql`](../supabase/audits/test-data-cleanup-proposal.sql) é bloqueado por `REVIEW_REQUIRED`. Ele:

1. abre uma transação e configura limites de lock/execução;
2. adquire um advisory lock para evitar duas limpezas simultâneas;
3. verifica relações obrigatórias, FKs inesperadas e triggers de exclusão;
4. interrompe se existirem pedidos operacionais abertos;
5. bloqueia escritas nas tabelas do escopo;
6. registra contagens antes e removidas;
7. exclui filhos antes de pais;
8. remove apenas auditoria operacional de pedidos/produtos;
9. valida tabelas vazias e contagens inalteradas de usuários/perfis;
10. efetua rollback automático em qualquer exceção.

## Backup e recuperação

Antes da futura execução:

1. Ativar/verificar PITR ou o backup diário do projeto no painel Supabase e registrar o horário do ponto de restauração.
2. Fazer um dump lógico com uma credencial de conexão administrativa, guardada fora do repositório:

   ```bash
   pg_dump "$SUPABASE_DB_URL" \
     --format=custom \
     --file=dogburger-pre-cleanup.dump \
     --table=auth.users \
     --table=public.profiles \
     --table=public.products \
     --table=public.orders \
     --table=public.order_items \
     --table=public.product_stock_movements \
     --table=public.order_cancellations \
     --table=public.order_status_history \
     --table=public.operational_audit_log \
     --table=public.expenses \
     --table=public.site_popup \
     --table=public.store_settings \
     --table=public.role_change_audit_log
   ```

3. Exportar a listagem e, se necessário, baixar o conteúdo do bucket `product-images` pela API/CLI do Supabase.
4. Testar `pg_restore --list dogburger-pre-cleanup.dump` e, idealmente, restaurar em um projeto isolado.
5. Executar primeiro uma cópia do SQL com `ROLLBACK` em homologação clonada.

Se a execução for confirmada por engano depois do `COMMIT`, a recuperação deve ocorrer por PITR ou restauração do dump em ambiente isolado, seguida de validação e troca controlada. Não tente reconstruir pedidos manualmente.

## Pendências antes da execução real

- anexar os resultados do SQL somente de leitura;
- confirmar FKs legadas de `order_items` e `orders`;
- revisar qualquer trigger encontrado no banco real;
- confirmar se despesas de homologação também devem ser removidas;
- decidir separadamente sobre imagens órfãs do Storage;
- confirmar que não há integração externa consumindo IDs de pedidos/produtos;
- obter autorização final e uma janela de manutenção.
