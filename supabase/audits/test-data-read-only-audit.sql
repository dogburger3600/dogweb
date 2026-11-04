-- Dog Burguer AppWeb
-- Auditoria SOMENTE DE LEITURA antes da limpeza comercial.
-- Execute cada bloco no SQL Editor do Supabase e salve os resultados.
-- Este arquivo não altera dados, políticas, funções ou estrutura.

-- 1. Relações identificadas no repositório e existência no banco real.
select expected.relation_name,
       to_regclass(expected.relation_name) is not null as exists_in_database
from (values
  ('auth.users'),
  ('public.profiles'),
  ('public.products'),
  ('public.orders'),
  ('public.order_items'),
  ('public.product_stock_movements'),
  ('public.order_cancellations'),
  ('public.order_status_history'),
  ('public.operational_audit_log'),
  ('public.expenses'),
  ('public.site_popup'),
  ('public.store_settings'),
  ('public.role_change_audit_log'),
  ('storage.objects')
) as expected(relation_name)
order by expected.relation_name;

-- 2. Todas as FKs que entram ou saem das tabelas operacionais.
select c.conname as constraint_name,
       c.conrelid::regclass as child_table,
       c.confrelid::regclass as parent_table,
       pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.contype = 'f'
  and (
    c.conrelid in (
      'public.products'::regclass,
      'public.orders'::regclass,
      'public.order_items'::regclass,
      'public.product_stock_movements'::regclass,
      'public.order_cancellations'::regclass,
      'public.order_status_history'::regclass,
      'public.operational_audit_log'::regclass
    )
    or c.confrelid in (
      'public.products'::regclass,
      'public.orders'::regclass,
      'public.order_items'::regclass,
      'public.product_stock_movements'::regclass,
      'public.order_cancellations'::regclass,
      'public.order_status_history'::regclass,
      'public.operational_audit_log'::regclass
    )
  )
order by child_table::text, constraint_name;

-- 3. Triggers de usuário nas tabelas que poderão ser limpas.
select t.tgrelid::regclass as table_name,
       t.tgname as trigger_name,
       t.tgenabled as enabled,
       pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
where not t.tgisinternal
  and t.tgrelid in (
    'public.products'::regclass,
    'public.orders'::regclass,
    'public.order_items'::regclass,
    'public.product_stock_movements'::regclass,
    'public.order_cancellations'::regclass,
    'public.order_status_history'::regclass,
    'public.operational_audit_log'::regclass
  )
order by table_name::text, trigger_name;

-- 4. Funções/RPCs cujo código menciona as tabelas operacionais.
select n.nspname as schema_name,
       p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       p.provolatile as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) ~* '(products|orders|order_items|product_stock_movements|order_cancellations|order_status_history|operational_audit_log)'
order by function_signature::text;

-- 5. RLS e políticas atuais.
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'products','orders','order_items','product_stock_movements',
    'order_cancellations','order_status_history','operational_audit_log',
    'expenses','profiles','site_popup','store_settings','role_change_audit_log'
  )
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in (
    'products','orders','order_items','product_stock_movements',
    'order_cancellations','order_status_history','operational_audit_log',
    'expenses','profiles','site_popup','store_settings','role_change_audit_log','objects'
  )
order by schemaname, tablename, policyname;

-- 6. Identidades, defaults e sequências; não redefina sem revisão explícita.
select c.table_schema, c.table_name, c.column_name, c.is_identity,
       c.identity_generation, c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'products','orders','order_items','product_stock_movements',
    'order_cancellations','order_status_history','operational_audit_log','expenses'
  )
  and (c.is_identity = 'YES' or c.column_default like 'nextval%')
order by c.table_name, c.ordinal_position;

select schemaname, sequencename, start_value, min_value, max_value,
       increment_by, cycle, cache_size, last_value
from pg_sequences
where schemaname = 'public'
order by sequencename;

-- 7. Contagens exatas antes da limpeza. Usuários e perfis são guardas.
select 'auth.users' as relation_name, count(*)::bigint as row_count from auth.users
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.products', count(*) from public.products
union all select 'public.orders', count(*) from public.orders
union all select 'public.order_items', count(*) from public.order_items
union all select 'public.product_stock_movements', count(*) from public.product_stock_movements
union all select 'public.order_cancellations', count(*) from public.order_cancellations
union all select 'public.order_status_history', count(*) from public.order_status_history
union all select 'public.operational_audit_log', count(*) from public.operational_audit_log
union all select 'public.expenses', count(*) from public.expenses
union all select 'public.site_popup', count(*) from public.site_popup
union all select 'public.store_settings', count(*) from public.store_settings
union all select 'public.role_change_audit_log', count(*) from public.role_change_audit_log
order by relation_name;

-- 8. Situação operacional dos pedidos. A limpeza não deve ocorrer com a loja em uso.
select status::text, count(*)::bigint as orders
from public.orders
group by status
order by status::text;

select count(*)::bigint as uncancelled_open_orders
from public.orders o
where o.status::text in ('pendente', 'preparando', 'pronto')
  and not exists (
    select 1 from public.order_cancellations c where c.order_id = o.id
  );

-- 9. Auditoria operacional que seria removida no escopo pedido/produto.
select entity_type, action, count(*)::bigint as events
from public.operational_audit_log
group by entity_type, action
order by entity_type, action;

-- 10. Dados excluídos do escopo automático: revisar, não apagar.
select count(*)::bigint as expenses_requiring_separate_authorization
from public.expenses;

select id, active, starts_at, ends_at, updated_at
from public.site_popup
order by id;

select id, updated_at, updated_by
from public.store_settings
order by id;

-- 11. Arquivos do catálogo. A remoção deve usar a Storage API, não DELETE SQL.
select bucket_id, count(*)::bigint as object_count,
       min(created_at) as oldest_object, max(created_at) as newest_object
from storage.objects
where bucket_id = 'product-images'
group by bucket_id;

select name, created_at, updated_at, metadata
from storage.objects
where bucket_id = 'product-images'
order by created_at, name;
