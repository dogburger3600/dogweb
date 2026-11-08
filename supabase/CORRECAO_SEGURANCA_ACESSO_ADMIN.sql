-- Dog Burger: bloqueio definitivo de acesso administrativo por contas comuns.
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- Nao altera pedidos, produtos, clientes ou o papel das contas existentes.

begin;

-- 1. A autorizacao sempre deriva do papel persistido no banco.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select profiles.role
  from public.profiles
  where profiles.id = auth.uid()
$function$;

create or replace function public.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    case public.current_user_role()::text
      when 'owner' then p_capability = any(array[
        'view_dashboard','view_orders','advance_orders','cancel_orders',
        'view_reports','manage_expenses','manage_stock','manage_menu',
        'manage_popup','manage_settings','view_audit','manage_roles'
      ])
      when 'manager' then p_capability = any(array[
        'view_dashboard','view_orders','advance_orders','cancel_orders',
        'view_reports','manage_expenses','manage_stock','manage_menu',
        'manage_popup','manage_settings','view_audit'
      ])
      when 'attendant' then p_capability = any(array[
        'view_dashboard','view_orders','advance_orders'
      ])
      else false
    end,
    false
  )
$function$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(public.current_user_role()::text in ('owner', 'manager'), false)
$function$;

-- 2. Todo perfil novo nasce obrigatoriamente como cliente.
create or replace function public.force_new_profile_customer_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.role := 'customer'::public.user_role;
  return new;
end;
$function$;

drop trigger if exists security_force_customer_role_on_insert on public.profiles;
drop trigger if exists s01_force_customer_role_on_insert on public.profiles;
create trigger security_force_customer_role_on_insert
before insert on public.profiles
for each row execute function public.force_new_profile_customer_role();

-- 3. Reconstrucao das permissoes diretas. Policies RLS nao substituem GRANTs.
revoke all privileges on table public.expenses from public, anon, authenticated;
revoke all privileges on table public.operational_audit_log from public, anon, authenticated;
revoke all privileges on table public.order_cancellations from public, anon, authenticated;
revoke all privileges on table public.order_items from public, anon, authenticated;
revoke all privileges on table public.order_status_history from public, anon, authenticated;
revoke all privileges on table public.orders from public, anon, authenticated;
revoke all privileges on table public.product_stock_movements from public, anon, authenticated;
revoke all privileges on table public.products from public, anon, authenticated;
revoke all privileges on table public.profiles from public, anon, authenticated;
revoke all privileges on table public.site_popup from public, anon, authenticated;
revoke all privileges on table public.store_settings from public, anon, authenticated;

grant select on table public.expenses to authenticated;
grant insert (description, amount, category) on table public.expenses to authenticated;

grant select on table public.orders to authenticated;
grant select (order_id, product_id, product_name, quantity, unit_price, removed_ingredients)
  on table public.order_items to authenticated;
grant select on table public.order_status_history to authenticated;
grant select on table public.order_cancellations to authenticated;
grant select on table public.product_stock_movements to authenticated;

grant select (id, name, description, ingredients, price, category, image_url, stock, min_stock, active, created_at)
  on table public.products to anon, authenticated;
grant insert (name, description, ingredients, price, cost, category, image_url, stock, min_stock, active)
  on table public.products to authenticated;
grant update (name, description, ingredients, price, cost, category, image_url, active)
  on table public.products to authenticated;

grant select on table public.profiles to authenticated;
grant update (name, phone, street, address_number, address_complement, neighborhood)
  on table public.profiles to authenticated;

grant select on table public.site_popup to anon, authenticated;
grant insert (id, title, message, image_url, button_text, button_url, active, starts_at, ends_at, updated_at)
  on table public.site_popup to authenticated;
grant update (id, title, message, image_url, button_text, button_url, active, starts_at, ends_at, updated_at)
  on table public.site_popup to authenticated;

revoke all privileges on sequence public.expenses_id_seq from public, anon, authenticated;
revoke all privileges on sequence public.products_id_seq from public, anon, authenticated;
grant usage on sequence public.expenses_id_seq to authenticated;
grant usage on sequence public.products_id_seq to authenticated;

-- 4. RLS autoritativa. Remove policies antigas para evitar regras permissivas concorrentes.
alter table public.expenses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_cancellations enable row level security;
alter table public.product_stock_movements enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.site_popup enable row level security;
alter table public.store_settings enable row level security;
alter table public.operational_audit_log enable row level security;

do $policies$
declare
  target text;
  policy_name text;
begin
  foreach target in array array[
    'expenses','orders','order_items','order_status_history','order_cancellations',
    'product_stock_movements','products','profiles','site_popup','operational_audit_log'
  ] loop
    for policy_name in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = target
    loop
      execute format('drop policy %I on public.%I', policy_name, target);
    end loop;
  end loop;
end;
$policies$;

create policy "expenses administrators read"
  on public.expenses for select to authenticated
  using (public.has_capability('manage_expenses'));
create policy "expenses administrators insert"
  on public.expenses for insert to authenticated
  with check (public.has_capability('manage_expenses'));

create policy "orders staff or owner read"
  on public.orders for select to authenticated
  using (public.has_capability('view_orders') or customer_id = auth.uid());
create policy "order items staff or owner read"
  on public.order_items for select to authenticated
  using (
    public.has_capability('view_orders')
    or exists (
      select 1 from public.orders
      where orders.id = order_items.order_id and orders.customer_id = auth.uid()
    )
  );
create policy "order history operational read"
  on public.order_status_history for select to authenticated
  using (public.has_capability('view_orders'));
create policy "order cancellations managers read"
  on public.order_cancellations for select to authenticated
  using (public.has_capability('cancel_orders'));
create policy "stock movements managers read"
  on public.product_stock_movements for select to authenticated
  using (public.has_capability('manage_stock'));

create policy "products public active read"
  on public.products for select to public using (active = true);
create policy "products managers read"
  on public.products for select to authenticated
  using (public.has_capability('manage_menu') or public.has_capability('manage_stock'));
create policy "products managers insert"
  on public.products for insert to authenticated
  with check (public.has_capability('manage_menu'));
create policy "products managers update"
  on public.products for update to authenticated
  using (public.has_capability('manage_menu'))
  with check (public.has_capability('manage_menu'));

create policy "profiles own or managers read"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_manager());
create policy "profiles own update"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "popup public active read"
  on public.site_popup for select to public
  using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );
create policy "popup managers read"
  on public.site_popup for select to authenticated
  using (public.has_capability('manage_popup'));
create policy "popup managers insert"
  on public.site_popup for insert to authenticated
  with check (public.has_capability('manage_popup'));
create policy "popup managers update"
  on public.site_popup for update to authenticated
  using (public.has_capability('manage_popup'))
  with check (public.has_capability('manage_popup'));

create policy "operational audit managers read"
  on public.operational_audit_log for select to authenticated
  using (public.has_capability('view_audit'));

-- 5. Funcoes: conexao somente para os papeis necessarios; a decisao final fica no servidor.
revoke all privileges on all functions in schema public from public, anon, authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_capability(text) to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.get_store_settings() to anon, authenticated;
grant execute on function public.update_store_settings(jsonb) to authenticated;
grant execute on function public.place_order(text, text, jsonb, text, numeric) to authenticated;
grant execute on function public.place_order(text, text, jsonb, text, numeric, text) to authenticated;
grant execute on function public.transition_order_status(bigint, text) to authenticated;
grant execute on function public.cancel_order(bigint, text) to authenticated;
grant execute on function public.restock_snack_product(bigint, integer, uuid, text) to authenticated;
grant execute on function public.set_snack_min_stock(bigint, integer) to authenticated;
grant execute on function public.get_manager_report(date, date) to authenticated;
grant execute on function public.get_operational_audit(integer, bigint, text, text) to authenticated;
grant execute on function public.get_admin_products() to authenticated;
grant execute on function public.get_admin_order_costs() to authenticated;
grant execute on function public.get_operational_cancellation_flags() to authenticated;

revoke all on function public.force_new_profile_customer_role() from public, anon, authenticated;

-- 6. Storage: somente perfis com capacidade de cardapio podem gravar imagens.
drop policy if exists "product images manager insert" on storage.objects;
drop policy if exists "product images manager update" on storage.objects;
drop policy if exists "product images manager delete" on storage.objects;
drop policy if exists "product images secure insert" on storage.objects;
drop policy if exists "product images secure update" on storage.objects;
drop policy if exists "product images secure delete" on storage.objects;

create policy "product images secure insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_capability('manage_menu'));
create policy "product images secure update"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_capability('manage_menu'))
  with check (bucket_id = 'product-images' and public.has_capability('manage_menu'));
create policy "product images secure delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_capability('manage_menu'));

notify pgrst, 'reload schema';

commit;

-- Verificacao: as quatro colunas devem retornar false para authenticated.
select
  has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') as cliente_pode_alterar_role,
  has_column_privilege('authenticated', 'public.profiles', 'points', 'UPDATE') as cliente_pode_alterar_points,
  has_column_privilege('anon', 'public.products', 'cost', 'SELECT') as anon_pode_ver_custo,
  has_column_privilege('authenticated', 'public.order_items', 'unit_cost', 'SELECT') as cliente_pode_ver_custo_pedido;
