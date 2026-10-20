-- B02: transicoes administrativas, cancelamento e auditoria de pedidos.
-- Preserva a assinatura e a implementacao existentes de public.place_order.

create or replace function public.transition_order_status(
  p_order_id bigint,
  p_to_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_status public.order_status;
  target_status public.order_status;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using errcode = '42501', message = 'Somente gestores podem alterar o estado de pedidos';
  end if;

  if p_to_status is null or p_to_status not in ('pendente', 'preparando', 'pronto', 'entregue') then
    raise exception using errcode = '22023', message = 'Estado de destino invalido';
  end if;

  target_status := p_to_status::public.order_status;

  select orders.status into current_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido nao encontrado';
  end if;

  if exists (select 1 from public.order_cancellations where order_id = p_order_id) then
    raise exception using errcode = '55000', message = 'Pedido cancelado nao pode mudar de estado';
  end if;

  if current_status = target_status then
    return jsonb_build_object('order_id', p_order_id, 'status', current_status::text, 'changed', false);
  end if;

  if not (
    (current_status = 'pendente' and target_status = 'preparando')
    or (current_status = 'preparando' and target_status = 'pronto')
    or (current_status = 'pronto' and target_status = 'entregue')
  ) then
    raise exception using errcode = '22023', message = format('Transicao de %s para %s nao permitida', current_status::text, target_status::text);
  end if;

  update public.orders set status = target_status where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (p_order_id, current_status::text, target_status::text, auth.uid());

  return jsonb_build_object('order_id', p_order_id, 'status', target_status::text, 'changed', true);
end;
$function$;

comment on function public.transition_order_status(bigint, text) is
  'Executa uma transicao sequencial de pedido, serializa concorrencia e registra auditoria.';

create or replace function public.cancel_order(
  p_order_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_status public.order_status;
  normalized_reason text := btrim(p_reason);
  existing_reason text;
  cancellation_time timestamptz;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using errcode = '42501', message = 'Somente gestores podem cancelar pedidos';
  end if;

  if normalized_reason is null or char_length(normalized_reason) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A justificativa deve ter entre 3 e 500 caracteres';
  end if;

  select orders.status into current_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido nao encontrado';
  end if;

  select reason, created_at into existing_reason, cancellation_time
  from public.order_cancellations
  where order_id = p_order_id;

  if found then
    if existing_reason = normalized_reason then
      return jsonb_build_object('order_id', p_order_id, 'cancelled', true, 'changed', false, 'reason', existing_reason, 'cancelled_at', cancellation_time);
    end if;
    raise exception using errcode = '55000', message = 'Pedido ja cancelado com outra justificativa';
  end if;

  if current_status = 'entregue' then
    raise exception using errcode = '22023', message = 'Pedido entregue nao pode ser cancelado';
  end if;

  insert into public.order_cancellations (order_id, reason, cancelled_by)
  values (p_order_id, normalized_reason, auth.uid())
  returning created_at into cancellation_time;

  return jsonb_build_object('order_id', p_order_id, 'cancelled', true, 'changed', true, 'reason', normalized_reason, 'cancelled_at', cancellation_time);
end;
$function$;

comment on function public.cancel_order(bigint, text) is
  'Cancela um pedido nao entregue com justificativa obrigatoria e repeticao idempotente.';

-- A partir da B02, alteracoes de estado passam exclusivamente pelas RPCs.
drop policy if exists "orders manager update" on public.orders;
revoke update (status) on table public.orders from authenticated;

revoke all on function public.transition_order_status(bigint, text) from public;
revoke all on function public.transition_order_status(bigint, text) from anon;
grant execute on function public.transition_order_status(bigint, text) to authenticated;

revoke all on function public.cancel_order(bigint, text) from public;
revoke all on function public.cancel_order(bigint, text) from anon;
grant execute on function public.cancel_order(bigint, text) to authenticated;

revoke insert, update, delete on table public.order_status_history from anon, authenticated;
revoke insert, update, delete on table public.order_cancellations from anon, authenticated;
grant select on table public.order_status_history to authenticated;
grant select on table public.order_cancellations to authenticated;

drop policy if exists "order status history manager read" on public.order_status_history;
create policy "order status history manager read"
  on public.order_status_history for select to authenticated
  using (public.is_manager());

drop policy if exists "order cancellations manager read" on public.order_cancellations;
create policy "order cancellations manager read"
  on public.order_cancellations for select to authenticated
  using (public.is_manager());
