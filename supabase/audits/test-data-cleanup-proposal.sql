-- Dog Burguer AppWeb
-- PROPOSTA PARA REVISÃO: não foi executada pelo Codex.
-- Pré-requisito: executar test-data-read-only-audit.sql, revisar todos os
-- resultados e produzir backup restaurável antes de alterar a confirmação.
--
-- Escopo autorizado nesta proposta:
--   pedidos, itens, cancelamentos, histórico, movimentos, produtos e eventos
--   operacionais cujo entity_type seja order ou product.
--
-- Preservado intencionalmente:
--   auth.users, profiles, role_change_audit_log, expenses, site_popup,
--   store_settings, eventos de store_settings, funções, triggers, RLS,
--   políticas, sequências e arquivos do Storage.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';
set local idle_in_transaction_session_timeout = '2min';

-- Impede duas limpezas simultâneas. Não substitui a janela de manutenção.
select pg_advisory_xact_lock(hashtextextended('dogburger:test-data-cleanup:v1', 0));

-- Trava de confirmação proposital. Altere somente após revisão e backup.
do $confirmation$
declare
  confirmation_text constant text := 'REVIEW_REQUIRED';
begin
  if confirmation_text <> 'DELETE_AUTHORIZED_TEST_DATA' then
    raise exception using
      errcode = 'P0001',
      message = 'Limpeza bloqueada: substitua REVIEW_REQUIRED somente após auditoria, backup e autorização final';
  end if;
end
$confirmation$;

-- Falha cedo se o banco real não tiver o contrato mínimo auditado.
do $relations$
declare
  missing_relations text;
begin
  select string_agg(required.relation_name, ', ' order by required.relation_name)
    into missing_relations
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
    ('public.role_change_audit_log')
  ) as required(relation_name)
  where to_regclass(required.relation_name) is null;

  if missing_relations is not null then
    raise exception 'Limpeza interrompida: relações esperadas ausentes: %', missing_relations;
  end if;
end
$relations$;

-- Qualquer tabela externa apontando para orders/products exige nova revisão.
do $foreign_keys$
declare
  unexpected_dependencies text;
begin
  select string_agg(
           format('%s: %s', c.conrelid::regclass, pg_get_constraintdef(c.oid, true)),
           E'\n' order by c.conrelid::regclass::text, c.conname
         )
    into unexpected_dependencies
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in ('public.orders'::regclass, 'public.products'::regclass)
    and not (
      (c.confrelid = 'public.orders'::regclass and c.conrelid in (
        'public.order_items'::regclass,
        'public.product_stock_movements'::regclass,
        'public.order_cancellations'::regclass,
        'public.order_status_history'::regclass
      ))
      or
      (c.confrelid = 'public.products'::regclass and c.conrelid in (
        'public.order_items'::regclass,
        'public.product_stock_movements'::regclass
      ))
    );

  if unexpected_dependencies is not null then
    raise exception 'Limpeza interrompida: FKs inesperadas precisam de revisão:%', E'\n' || unexpected_dependencies;
  end if;
end
$foreign_keys$;

-- O repositório não define triggers DELETE nessas tabelas. Se o banco real
-- tiver algum, interrompe para impedir efeitos colaterais não auditados.
do $delete_triggers$
declare
  delete_triggers text;
begin
  select string_agg(
           format('%s.%I: %s', t.tgrelid::regclass, t.tgname, pg_get_triggerdef(t.oid, true)),
           E'\n' order by t.tgrelid::regclass::text, t.tgname
         )
    into delete_triggers
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
    and pg_get_triggerdef(t.oid, true) ~* '(DELETE|TRUNCATE)';

  if delete_triggers is not null then
    raise exception 'Limpeza interrompida: triggers de exclusão precisam de revisão:%', E'\n' || delete_triggers;
  end if;
end
$delete_triggers$;

-- Não inicia enquanto houver pedidos operacionais abertos.
do $open_orders$
declare
  open_orders bigint;
begin
  select count(*) into open_orders
  from public.orders o
  where o.status::text in ('pendente', 'preparando', 'pronto')
    and not exists (
      select 1 from public.order_cancellations c where c.order_id = o.id
    );

  if open_orders > 0 then
    raise exception 'Limpeza interrompida: existem % pedidos operacionais abertos', open_orders;
  end if;
end
$open_orders$;

-- SHARE ROW EXCLUSIVE bloqueia novas escritas, mas mantém leituras disponíveis.
-- A ordem começa por products porque place_order também bloqueia produtos antes
-- de criar os registros de pedido.
lock table public.products,
           public.orders,
           public.order_items,
           public.product_stock_movements,
           public.order_cancellations,
           public.order_status_history,
           public.operational_audit_log
  in share row exclusive mode;

-- Repete a guarda já sob lock para fechar a janela entre a primeira leitura e
-- o bloqueio das tabelas.
do $open_orders_after_lock$
declare
  open_orders bigint;
begin
  select count(*) into open_orders
  from public.orders o
  where o.status::text in ('pendente', 'preparando', 'pronto')
    and not exists (
      select 1 from public.order_cancellations c where c.order_id = o.id
    );

  if open_orders > 0 then
    raise exception 'Limpeza interrompida após lock: existem % pedidos operacionais abertos', open_orders;
  end if;
end
$open_orders_after_lock$;

create temporary table cleanup_result (
  relation_name text primary key,
  before_count bigint not null,
  removed_count bigint not null default 0,
  after_count bigint
) on commit preserve rows;

create temporary table cleanup_identity_guard (
  auth_users_before bigint not null,
  profiles_before bigint not null,
  expenses_before bigint not null,
  site_popup_before bigint not null,
  store_settings_before bigint not null,
  role_audit_before bigint not null
) on commit preserve rows;

insert into cleanup_identity_guard
select (select count(*) from auth.users),
       (select count(*) from public.profiles),
       (select count(*) from public.expenses),
       (select count(*) from public.site_popup),
       (select count(*) from public.store_settings),
       (select count(*) from public.role_change_audit_log);

insert into cleanup_result (relation_name, before_count) values
  ('public.order_status_history', (select count(*) from public.order_status_history)),
  ('public.order_cancellations', (select count(*) from public.order_cancellations)),
  ('public.product_stock_movements', (select count(*) from public.product_stock_movements)),
  ('public.order_items', (select count(*) from public.order_items)),
  ('public.orders', (select count(*) from public.orders)),
  ('public.products', (select count(*) from public.products)),
  ('public.operational_audit_log:order/product', (
    select count(*) from public.operational_audit_log where entity_type in ('order', 'product')
  ));

do $delete_data$
declare
  affected bigint;
begin
  delete from public.order_status_history;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.order_status_history';

  delete from public.order_cancellations;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.order_cancellations';

  delete from public.product_stock_movements;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.product_stock_movements';

  delete from public.order_items;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.order_items';

  delete from public.orders;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.orders';

  delete from public.products;
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected where relation_name = 'public.products';

  delete from public.operational_audit_log where entity_type in ('order', 'product');
  get diagnostics affected = row_count;
  update cleanup_result set removed_count = affected
  where relation_name = 'public.operational_audit_log:order/product';
end
$delete_data$;

update cleanup_result
set after_count = case relation_name
  when 'public.order_status_history' then (select count(*) from public.order_status_history)
  when 'public.order_cancellations' then (select count(*) from public.order_cancellations)
  when 'public.product_stock_movements' then (select count(*) from public.product_stock_movements)
  when 'public.order_items' then (select count(*) from public.order_items)
  when 'public.orders' then (select count(*) from public.orders)
  when 'public.products' then (select count(*) from public.products)
  when 'public.operational_audit_log:order/product' then (
    select count(*) from public.operational_audit_log where entity_type in ('order', 'product')
  )
end;

do $validate$
declare
  invalid_counts text;
  identity_changed boolean;
begin
  select string_agg(relation_name, ', ' order by relation_name)
    into invalid_counts
  from cleanup_result
  where after_count <> 0
     or before_count <> removed_count;

  select (guard.auth_users_before <> (select count(*) from auth.users))
      or (guard.profiles_before <> (select count(*) from public.profiles))
      or (guard.expenses_before <> (select count(*) from public.expenses))
      or (guard.site_popup_before <> (select count(*) from public.site_popup))
      or (guard.store_settings_before <> (select count(*) from public.store_settings))
      or (guard.role_audit_before <> (select count(*) from public.role_change_audit_log))
    into identity_changed
  from cleanup_identity_guard guard;

  if invalid_counts is not null then
    raise exception 'Validação falhou; rollback automático. Contagens inválidas: %', invalid_counts;
  end if;
  if identity_changed then
    raise exception 'Validação falhou; rollback automático. Usuários ou perfis foram alterados';
  end if;
end
$validate$;

-- Resultado esperado: after_count = 0 e before_count = removed_count.
select relation_name, before_count, removed_count, after_count
from cleanup_result
order by relation_name;

select guard.auth_users_before,
       (select count(*) from auth.users) as auth_users_after,
       guard.profiles_before,
       (select count(*) from public.profiles) as profiles_after,
       guard.expenses_before,
       (select count(*) from public.expenses) as expenses_after,
       guard.site_popup_before,
       (select count(*) from public.site_popup) as site_popup_after,
       guard.store_settings_before,
       (select count(*) from public.store_settings) as store_settings_after,
       guard.role_audit_before,
       (select count(*) from public.role_change_audit_log) as role_audit_after
from cleanup_identity_guard guard;

-- Para um ensaio controlado, substitua COMMIT por ROLLBACK.
commit;

-- Não reinicia sequências: evita reutilizar identificadores históricos.
-- Não remove expenses/site_popup/store_settings/role_change_audit_log.
-- Não remova storage.objects por SQL; use a Storage API após autorização.
