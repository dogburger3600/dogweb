-- S02: RLS, ACL, dados financeiros internos, Storage e RPCs por capability.

-- Catalogo publico: custo nunca e legivel pelos papeis da API.
revoke select on table public.products from public, anon, authenticated;
revoke select (cost) on public.products from public, anon, authenticated;
grant select (id, name, description, ingredients, price, category, image_url, stock, min_stock, active, created_at)
  on public.products to anon, authenticated;

-- Snapshot de custo do pedido e interno. Clientes continuam vendo os demais campos.
revoke select on table public.order_items from public, anon, authenticated;
revoke select (unit_cost) on public.order_items from public, anon, authenticated;
grant select (order_id, product_id, product_name, quantity, unit_price, removed_ingredients)
  on public.order_items to authenticated;

create or replace function public.get_admin_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare result jsonb;
begin
  if not public.has_capability('manage_menu') and not public.has_capability('manage_stock') then
    raise exception using errcode = '42501', message = 'Acesso administrativo negado';
  end if;
  select coalesce(jsonb_agg(to_jsonb(products) order by products.created_at desc), '[]'::jsonb)
    into result from public.products;
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
declare result jsonb;
begin
  if not public.has_capability('view_reports') then
    raise exception using errcode = '42501', message = 'Acesso a custos negado';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', items.order_id, 'product_id', items.product_id, 'unit_cost', items.unit_cost
  )), '[]'::jsonb) into result
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
declare result jsonb;
begin
  if not public.has_capability('view_orders') then
    raise exception using errcode = '42501', message = 'Acesso operacional negado';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_id', cancellations.order_id)), '[]'::jsonb)
    into result from public.order_cancellations cancellations;
  return result;
end;
$function$;

revoke all on function public.get_admin_products() from public, anon, authenticated;
revoke all on function public.get_admin_order_costs() from public, anon, authenticated;
revoke all on function public.get_operational_cancellation_flags() from public, anon, authenticated;
grant execute on function public.get_admin_products() to authenticated;
grant execute on function public.get_admin_order_costs() to authenticated;
grant execute on function public.get_operational_cancellation_flags() to authenticated;

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

-- Policies passam a ser especificacao autoritativa. O loop e intencional para
-- remover nomes historicos desconhecidos sem deixar policies permissivas concorrentes.
do $policies$
declare target text; policy_name text;
begin
  foreach target in array array['expenses','orders','order_items','order_status_history','order_cancellations','product_stock_movements','products','profiles','site_popup','operational_audit_log'] loop
    for policy_name in select policyname from pg_policies where schemaname='public' and tablename=target loop
      execute format('drop policy %I on public.%I', policy_name, target);
    end loop;
  end loop;
end;
$policies$;

create policy "expenses administrators read" on public.expenses for select to authenticated using (public.has_capability('manage_expenses'));
create policy "expenses administrators insert" on public.expenses for insert to authenticated with check (public.has_capability('manage_expenses'));
create policy "expenses administrators update" on public.expenses for update to authenticated using (public.has_capability('manage_expenses')) with check (public.has_capability('manage_expenses'));
create policy "expenses administrators delete" on public.expenses for delete to authenticated using (public.has_capability('manage_expenses'));

create policy "orders staff or owner read" on public.orders for select to authenticated using (public.has_capability('view_orders') or customer_id = auth.uid());
create policy "order items staff or owner read" on public.order_items for select to authenticated using (public.has_capability('view_orders') or exists (select 1 from public.orders where orders.id=order_items.order_id and orders.customer_id=auth.uid()));
create policy "order history operational read" on public.order_status_history for select to authenticated using (public.has_capability('view_orders'));
create policy "order cancellations managers read" on public.order_cancellations for select to authenticated using (public.has_capability('cancel_orders'));
create policy "stock movements managers read" on public.product_stock_movements for select to authenticated using (public.has_capability('manage_stock'));

create policy "products public active read" on public.products for select to public using (active = true);
create policy "products managers read" on public.products for select to authenticated using (public.has_capability('manage_menu') or public.has_capability('manage_stock'));
create policy "products managers insert" on public.products for insert to authenticated with check (public.has_capability('manage_menu'));
create policy "products managers update" on public.products for update to authenticated using (public.has_capability('manage_menu')) with check (public.has_capability('manage_menu'));

create policy "profiles own or managers read" on public.profiles for select to authenticated using (id=auth.uid() or public.is_manager());
create policy "profiles own update" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

create policy "popup public active read"
on public.site_popup for select to public
using (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);
create policy "popup managers read" on public.site_popup for select to authenticated using (public.has_capability('manage_popup'));
create policy "popup managers insert" on public.site_popup for insert to authenticated with check (public.has_capability('manage_popup'));
create policy "popup managers update" on public.site_popup for update to authenticated using (public.has_capability('manage_popup')) with check (public.has_capability('manage_popup'));

create policy "operational audit managers read" on public.operational_audit_log for select to authenticated using (public.has_capability('view_audit'));

-- As policies públicas antigas já foram substituídas e não dependem mais de
-- is_manager(). Encerra a concessão transitória feita por S00/S01.
revoke all on function public.is_manager() from public, anon, authenticated;
grant execute on function public.is_manager() to authenticated;

-- Attendant pode avancar pedidos, mas nenhuma outra RPC administrativa.
create or replace function public.transition_order_status(p_order_id bigint, p_to_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare current_status public.order_status; target_status public.order_status;
begin
  if auth.uid() is null or not public.has_capability('advance_orders') then raise exception using errcode='42501', message='Perfil sem permissao para alterar o estado de pedidos'; end if;
  if p_to_status is null or p_to_status not in ('pendente','preparando','pronto','entregue') then raise exception using errcode='22023', message='Estado de destino invalido'; end if;
  target_status := p_to_status::public.order_status;
  select status into current_status from public.orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002', message='Pedido nao encontrado'; end if;
  if exists(select 1 from public.order_cancellations where order_id=p_order_id) then raise exception using errcode='55000', message='Pedido cancelado nao pode mudar de estado'; end if;
  if current_status=target_status then return jsonb_build_object('order_id',p_order_id,'status',current_status::text,'changed',false); end if;
  if not ((current_status='pendente' and target_status='preparando') or (current_status='preparando' and target_status='pronto') or (current_status='pronto' and target_status='entregue')) then
    raise exception using errcode='22023', message=format('Transicao de %s para %s nao permitida',current_status::text,target_status::text);
  end if;
  update public.orders set status=target_status where id=p_order_id;
  insert into public.order_status_history(order_id,from_status,to_status,changed_by) values(p_order_id,current_status::text,target_status::text,auth.uid());
  perform public.write_operational_audit_event('order.status_changed','order',p_order_id::text,jsonb_build_object('from_status',current_status::text,'to_status',target_status::text));
  return jsonb_build_object('order_id',p_order_id,'status',target_status::text,'changed',true);
end;
$function$;

-- Funcao interna: EXECUTE continua revogado; aceita staff porque apenas RPCs
-- autorizadas podem chama-la.
create or replace function public.write_operational_audit_event(p_action text,p_entity_type text,p_entity_id text,p_context jsonb)
returns bigint language plpgsql security definer set search_path=public,pg_temp
as $function$
declare new_event_id bigint;
begin
  if auth.uid() is null or coalesce(public.current_user_role()::text not in ('owner','manager','attendant'), true) then raise exception using errcode='42501', message='Perfil sem permissao para registrar auditoria'; end if;
  if p_action is null or p_action not in ('order.status_changed','order.cancelled','inventory.restocked','inventory.minimum_changed','store_settings.updated') then raise exception using errcode='22023', message='Acao de auditoria invalida'; end if;
  if p_entity_type is null or p_entity_type not in ('order','product','store_settings') or nullif(btrim(p_entity_id),'') is null or char_length(btrim(p_entity_id))>120 then raise exception using errcode='22023', message='Alvo de auditoria invalido'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' then raise exception using errcode='22023', message='Contexto de auditoria invalido'; end if;
  insert into public.operational_audit_log(actor_id,action,entity_type,entity_id,context) values(auth.uid(),p_action,p_entity_type,btrim(p_entity_id),p_context) returning id into new_event_id;
  return new_event_id;
end;
$function$;

revoke all on function public.transition_order_status(bigint,text) from public, anon, authenticated;
grant execute on function public.transition_order_status(bigint,text) to authenticated;
revoke all on function public.write_operational_audit_event(text,text,text,jsonb) from public, anon, authenticated;

-- ACL efetiva das RPCs: a permissao de conexao e ampla somente onde o contrato
-- exige; cada RPC administrativa faz a decisao server-side por capability.
revoke all on function public.cancel_order(bigint,text) from public, anon;
revoke all on function public.restock_snack_product(bigint,integer,uuid,text) from public, anon;
revoke all on function public.set_snack_min_stock(bigint,integer) from public, anon;
revoke all on function public.update_store_settings(jsonb) from public, anon;
revoke all on function public.get_store_settings() from public, anon, authenticated;
revoke all on function public.get_manager_report(date,date) from public, anon;
revoke all on function public.get_operational_audit(integer,bigint,text,text) from public, anon;
revoke all on function public.place_order(text,text,jsonb,text,numeric) from public, anon;
revoke all on function public.place_order(text,text,jsonb,text,numeric,text) from public, anon;
grant execute on function public.cancel_order(bigint,text) to authenticated;
grant execute on function public.restock_snack_product(bigint,integer,uuid,text) to authenticated;
grant execute on function public.set_snack_min_stock(bigint,integer) to authenticated;
grant execute on function public.update_store_settings(jsonb) to authenticated;
grant execute on function public.get_store_settings() to anon, authenticated;
grant execute on function public.get_manager_report(date,date) to authenticated;
grant execute on function public.get_operational_audit(integer,bigint,text,text) to authenticated;
grant execute on function public.place_order(text,text,jsonb,text,numeric) to authenticated;
grant execute on function public.place_order(text,text,jsonb,text,numeric,text) to authenticated;

-- Storage: leitura publica permanece; escrita depende de owner/manager via is_manager.
drop policy if exists "product images manager insert" on storage.objects;
drop policy if exists "product images manager update" on storage.objects;
drop policy if exists "product images manager delete" on storage.objects;
drop policy if exists "product images secure insert" on storage.objects;
drop policy if exists "product images secure update" on storage.objects;
drop policy if exists "product images secure delete" on storage.objects;
create policy "product images secure insert" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.has_capability('manage_menu'));
create policy "product images secure update" on storage.objects for update to authenticated using (bucket_id='product-images' and public.has_capability('manage_menu')) with check (bucket_id='product-images' and public.has_capability('manage_menu'));
create policy "product images secure delete" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.has_capability('manage_menu'));

-- Trigger/event-trigger helpers nunca sao APIs do cliente.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.force_new_profile_customer_role() from public, anon, authenticated;
revoke all on function public.restrict_removed_ingredients_to_snacks() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
