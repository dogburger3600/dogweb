-- S00 — Data API ACL Baseline
--
-- Reconstrói de forma determinística as ACLs das tabelas, colunas,
-- sequences e funções expostas pelo schema public.
--
-- Não modifica dados, roles de usuários, ownership, RLS, policies,
-- definições de funções ou definições de sequences.

-- ============================================================
-- 1. REVOGAÇÃO DAS ACLs HISTÓRICAS DE TABELA
-- ============================================================

revoke all privileges on table public.expenses
  from public, anon, authenticated;

revoke all privileges on table public.operational_audit_log
  from public, anon, authenticated;

revoke all privileges on table public.order_cancellations
  from public, anon, authenticated;

revoke all privileges on table public.order_items
  from public, anon, authenticated;

revoke all privileges on table public.order_status_history
  from public, anon, authenticated;

revoke all privileges on table public.orders
  from public, anon, authenticated;

revoke all privileges on table public.product_stock_movements
  from public, anon, authenticated;

revoke all privileges on table public.products
  from public, anon, authenticated;

revoke all privileges on table public.profiles
  from public, anon, authenticated;

revoke all privileges on table public.site_popup
  from public, anon, authenticated;

revoke all privileges on table public.store_settings
  from public, anon, authenticated;

-- REVOKE em nível de tabela não é suficiente para remover grants
-- históricos concedidos diretamente em colunas. Remove também todas
-- as ACLs de coluna dos três papéis da Data API.

do $s00_column_acl$
declare
  target_table text;
  target_column text;
begin
  foreach target_table in array array[
    'expenses',
    'operational_audit_log',
    'order_cancellations',
    'order_items',
    'order_status_history',
    'orders',
    'product_stock_movements',
    'products',
    'profiles',
    'site_popup',
    'store_settings'
  ]
  loop
    for target_column in
      select attributes.attname
      from pg_catalog.pg_attribute attributes
      join pg_catalog.pg_class relations
        on relations.oid = attributes.attrelid
      join pg_catalog.pg_namespace namespaces
        on namespaces.oid = relations.relnamespace
      where namespaces.nspname = 'public'
        and relations.relname = target_table
        and relations.relkind in ('r', 'p')
        and attributes.attnum > 0
        and not attributes.attisdropped
      order by attributes.attnum
    loop
      execute format(
        'revoke select (%I) on table public.%I from public, anon, authenticated',
        target_column,
        target_table
      );

      execute format(
        'revoke insert (%I) on table public.%I from public, anon, authenticated',
        target_column,
        target_table
      );

      execute format(
        'revoke update (%I) on table public.%I from public, anon, authenticated',
        target_column,
        target_table
      );

      execute format(
        'revoke references (%I) on table public.%I from public, anon, authenticated',
        target_column,
        target_table
      );
    end loop;
  end loop;
end;
$s00_column_acl$;

-- ============================================================
-- 2. RECONSTRUÇÃO DAS ACLs MÍNIMAS DE TABELA E COLUNA
-- ============================================================

-- Despesas: consulta e cadastro administrativo comprovados.
grant select on table public.expenses
  to authenticated;

grant insert (description, amount, category)
  on table public.expenses
  to authenticated;

-- Pedidos: leitura direta; toda escrita ocorre por RPC.
grant select on table public.orders
  to authenticated;

grant select (
  order_id,
  product_id,
  product_name,
  quantity,
  unit_price,
  removed_ingredients
)
  on table public.order_items
  to authenticated;

grant select on table public.order_status_history
  to authenticated;

grant select on table public.order_cancellations
  to authenticated;

-- Estoque: leitura do histórico; escrita somente por RPC.
grant select on table public.product_stock_movements
  to authenticated;

-- Produtos: catálogo público sem exposição direta do custo.
grant select (
  id,
  name,
  description,
  ingredients,
  price,
  category,
  image_url,
  stock,
  min_stock,
  active,
  created_at
)
  on table public.products
  to anon, authenticated;

-- Cadastro administrativo de produto.
grant insert (
  name,
  description,
  ingredients,
  price,
  cost,
  category,
  image_url,
  stock,
  min_stock,
  active
)
  on table public.products
  to authenticated;

-- Edição administrativa sem escrita direta em saldo ou estoque mínimo.
grant update (
  name,
  description,
  ingredients,
  price,
  cost,
  category,
  image_url,
  active
)
  on table public.products
  to authenticated;

-- Perfis: leitura autenticada e atualização somente de dados pessoais.
grant select on table public.profiles
  to authenticated;

grant update (
  name,
  phone,
  street,
  address_number,
  address_complement,
  neighborhood
)
  on table public.profiles
  to authenticated;

-- Pop-up: leitura pública e UPSERT administrativo.
grant select on table public.site_popup
  to anon, authenticated;

grant insert (
  id,
  title,
  message,
  image_url,
  button_text,
  button_url,
  active,
  starts_at,
  ends_at,
  updated_at
)
  on table public.site_popup
  to authenticated;

grant update (
  id,
  title,
  message,
  image_url,
  button_text,
  button_url,
  active,
  starts_at,
  ends_at,
  updated_at
)
  on table public.site_popup
  to authenticated;

-- Permanecem completamente fechadas para acesso direto:
-- public.operational_audit_log
-- public.store_settings

-- ============================================================
-- 3. BASELINE DAS SEQUENCES
-- ============================================================

revoke all privileges on sequence public.expenses_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.operational_audit_log_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.order_items_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.order_status_history_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.orders_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.product_stock_movements_id_seq
  from public, anon, authenticated;

revoke all privileges on sequence public.products_id_seq
  from public, anon, authenticated;

-- Somente inserts diretos legítimos precisam de nextval.
grant usage on sequence public.expenses_id_seq
  to authenticated;

grant usage on sequence public.products_id_seq
  to authenticated;

-- Nenhuma sequence recebe SELECT ou UPDATE para clientes da Data API.

-- ============================================================
-- 4. BASELINE DAS FUNÇÕES EXISTENTES
-- ============================================================

-- Remove EXECUTE histórico, inclusive grants implícitos a PUBLIC.
-- As funções necessárias são concedidas novamente de forma explícita.
revoke all privileges on all functions in schema public
  from public, anon, authenticated;

-- Exceção transitória necessária às policies públicas restauradas de products
-- e site_popup. S02 substituirá essas policies e removerá o acesso de anon.
grant execute on function public.is_manager()
  to anon, authenticated;

-- Configurações da loja.
grant execute on function public.get_store_settings()
  to anon, authenticated;

grant execute on function public.update_store_settings(jsonb)
  to authenticated;

-- Pedidos.
grant execute on function public.place_order(
  text,
  text,
  jsonb,
  text,
  numeric
)
  to authenticated;

grant execute on function public.place_order(
  text,
  text,
  jsonb,
  text,
  numeric,
  text
)
  to authenticated;

grant execute on function public.transition_order_status(bigint, text)
  to authenticated;

grant execute on function public.cancel_order(bigint, text)
  to authenticated;

-- Estoque.
grant execute on function public.restock_snack_product(
  bigint,
  integer,
  uuid,
  text
)
  to authenticated;

grant execute on function public.set_snack_min_stock(bigint, integer)
  to authenticated;

-- Relatórios e auditoria.
grant execute on function public.get_manager_report(date, date)
  to authenticated;

grant execute on function public.get_operational_audit(
  integer,
  bigint,
  text,
  text
)
  to authenticated;

-- Permanecem sem EXECUTE para clientes:
-- public.handle_new_user()
-- public.restrict_removed_ingredients_to_snacks()
-- public.rls_auto_enable()
-- public.write_operational_audit_event(text, text, text, jsonb)
--
-- S01/S02 criarão ou substituirão suas funções e reafirmarão as ACLs
-- finais correspondentes.
