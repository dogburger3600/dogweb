-- Reparo emergencial da area do gestor para o banco recuperado.
--
-- Pode ser executado inteiro no SQL Editor do Supabase.
-- Nao altera produtos, pedidos, perfis nem outros dados existentes.
-- Apenas recompõe as funcoes de autorizacao/leitura que o frontend atual usa.

begin;

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

create or replace function public.get_admin_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  result jsonb;
begin
  if not public.has_capability('manage_menu')
     and not public.has_capability('manage_stock') then
    raise exception using errcode = '42501', message = 'Acesso administrativo negado';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(products) order by products.created_at desc),
    '[]'::jsonb
  )
  into result
  from public.products;

  return result;
end;
$function$;

create or replace function public.get_admin_order_costs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  result jsonb;
begin
  if not public.has_capability('view_reports') then
    raise exception using errcode = '42501', message = 'Acesso a custos negado';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'order_id', items.order_id,
      'product_id', items.product_id,
      'unit_cost', items.unit_cost
    )),
    '[]'::jsonb
  )
  into result
  from public.order_items items;

  return result;
end;
$function$;

create or replace function public.get_operational_cancellation_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  result jsonb;
begin
  if not public.has_capability('view_orders') then
    raise exception using errcode = '42501', message = 'Acesso operacional negado';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('order_id', cancellations.order_id)),
    '[]'::jsonb
  )
  into result
  from public.order_cancellations cancellations;

  return result;
end;
$function$;

revoke all on function public.current_user_role() from public, anon, authenticated;
revoke all on function public.has_capability(text) from public, anon, authenticated;
revoke all on function public.is_manager() from public, anon, authenticated;
revoke all on function public.get_admin_products() from public, anon, authenticated;
revoke all on function public.get_admin_order_costs() from public, anon, authenticated;
revoke all on function public.get_operational_cancellation_flags() from public, anon, authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_capability(text) to authenticated;
-- Mantido para compatibilidade com policies antigas do banco recuperado.
grant execute on function public.is_manager() to anon, authenticated;
grant execute on function public.get_admin_products() to authenticated;
grant execute on function public.get_admin_order_costs() to authenticated;
grant execute on function public.get_operational_cancellation_flags() to authenticated;

-- Faz a API do Supabase reconhecer as funcoes imediatamente.
notify pgrst, 'reload schema';

commit;

-- Resultado esperado no SQL Editor: Success. No rows returned.
