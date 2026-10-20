-- B04: estoque transacional de unidades de lanches prontos.
-- Nao representa ingredientes e nao reserva unidades no carrinho.

alter table public.product_stock_movements
  add column if not exists operation_id uuid;

create unique index if not exists product_stock_movements_operation_idx
  on public.product_stock_movements (operation_id)
  where operation_id is not null;

create unique index if not exists product_stock_movements_order_reason_idx
  on public.product_stock_movements (order_id, product_id, reason)
  where order_id is not null and reason in ('order_debit', 'order_restore');

create or replace function public.place_order(
  p_customer_name text,
  p_note text,
  p_items jsonb,
  p_payment_method text,
  p_change_for numeric default null::numeric
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  new_order_id bigint;
  item jsonb;
  selected_product public.products%rowtype;
  requested_qty integer;
  order_address jsonb;
  order_total numeric(10,2) := 0;
  normalized_change numeric(10,2) := null;
  stock_item record;
begin
  if auth.uid() is null then
    raise exception 'É necessário entrar na conta para fazer um pedido';
  end if;
  if length(trim(p_customer_name)) < 2
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido inválido';
  end if;
  if p_payment_method not in ('pix', 'credito', 'debito', 'dinheiro') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if p_payment_method = 'dinheiro' then
    normalized_change := p_change_for;
  end if;

  select jsonb_build_object(
    'street', street,
    'number', address_number,
    'complement', address_complement,
    'neighborhood', neighborhood
  )
  into order_address
  from public.profiles
  where id = auth.uid();

  if order_address is null then
    raise exception 'Perfil do cliente não encontrado';
  end if;

  -- A ordem fixa dos locks evita deadlock entre pedidos com varios produtos.
  perform products.id
  from public.products products
  join (
    select distinct (raw_item->>'product_id')::bigint as product_id
    from jsonb_array_elements(p_items) raw_item
  ) requested on requested.product_id = products.id
  order by products.id
  for update of products;

  insert into public.orders (
    customer_id, customer_name, note, delivery_address, payment_method, change_for
  ) values (
    auth.uid(), trim(p_customer_name), coalesce(trim(p_note), ''), order_address,
    p_payment_method, normalized_change
  ) returning id into new_order_id;

  for item in select * from jsonb_array_elements(p_items) loop
    begin
      requested_qty := (item->>'quantity')::integer;
    exception when others then
      raise exception 'Produto indisponível';
    end;

    select * into selected_product
    from public.products
    where id = (item->>'product_id')::bigint and active = true;

    if not found or requested_qty <= 0 then
      raise exception 'Produto indisponível';
    end if;

    order_total := order_total + (selected_product.price * requested_qty);

    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price, unit_cost, removed_ingredients
    ) values (
      new_order_id, selected_product.id, selected_product.name, requested_qty,
      selected_product.price, selected_product.cost,
      left(coalesce(trim(item->>'removed_ingredients'), ''), 120)
    );
  end loop;

  for stock_item in
    select products.id as product_id,
           products.name,
           coalesce(products.stock, 0) as stock,
           sum((raw_item->>'quantity')::integer)::integer as requested_quantity
    from jsonb_array_elements(p_items) raw_item
    join public.products products
      on products.id = (raw_item->>'product_id')::bigint
    where products.category = 'lanches'
    group by products.id, products.name, products.stock
    order by products.id
  loop
    if stock_item.stock < stock_item.requested_quantity then
      raise exception using
        errcode = '23514',
        message = format(
          'Estoque insuficiente para %s: disponível %s, solicitado %s',
          stock_item.name,
          stock_item.stock,
          stock_item.requested_quantity
        );
    end if;

    update public.products
    set stock = coalesce(stock, 0) - stock_item.requested_quantity
    where id = stock_item.product_id
    returning stock into stock_item.stock;

    insert into public.product_stock_movements (
      product_id, quantity_delta, resulting_stock, reason, order_id, created_by
    ) values (
      stock_item.product_id,
      -stock_item.requested_quantity,
      stock_item.stock,
      'order_debit',
      new_order_id,
      auth.uid()
    );
  end loop;

  if normalized_change is not null and normalized_change < order_total then
    raise exception 'O valor para troco deve ser igual ou maior que o total do pedido';
  end if;

  return new_order_id;
end;
$function$;

comment on function public.place_order(text, text, jsonb, text, numeric) is
  'Cria o pedido e debita atomicamente somente unidades prontas da categoria lanches.';

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
  stock_item record;
  stock_was_restored boolean := false;
  resulting_stock integer;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using
      errcode = '42501',
      message = 'Somente gestores podem cancelar pedidos';
  end if;

  if normalized_reason is null
     or char_length(normalized_reason) not between 3 and 500 then
    raise exception using
      errcode = '22023',
      message = 'A justificativa deve ter entre 3 e 500 caracteres';
  end if;

  select orders.status
    into current_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido nao encontrado';
  end if;

  select reason, created_at
    into existing_reason, cancellation_time
  from public.order_cancellations
  where order_id = p_order_id;

  if found then
    if existing_reason = normalized_reason then
      return jsonb_build_object(
        'order_id', p_order_id,
        'cancelled', true,
        'changed', false,
        'reason', existing_reason,
        'cancelled_at', cancellation_time,
        'stock_restored', exists (
          select 1 from public.product_stock_movements
          where order_id = p_order_id and reason = 'order_restore'
        )
      );
    end if;
    raise exception using errcode = '55000', message = 'Pedido ja cancelado com outra justificativa';
  end if;

  if current_status = 'entregue' then
    raise exception using errcode = '22023', message = 'Pedido entregue nao pode ser cancelado';
  end if;

  insert into public.order_cancellations (order_id, reason, cancelled_by)
  values (p_order_id, normalized_reason, auth.uid())
  returning created_at into cancellation_time;

  -- Regra B04: somente cancelamento ainda pendente restaura automaticamente.
  if current_status = 'pendente' then
    for stock_item in
      select products.id as product_id,
             sum(-movements.quantity_delta)::integer as restore_quantity
      from public.product_stock_movements movements
      join public.products products on products.id = movements.product_id
      where movements.order_id = p_order_id
        and movements.reason = 'order_debit'
        and movements.quantity_delta < 0
        and products.category = 'lanches'
      group by products.id
      order by products.id
    loop
      perform 1 from public.products where id = stock_item.product_id for update;

      update public.products
      set stock = coalesce(stock, 0) + stock_item.restore_quantity
      where id = stock_item.product_id
      returning stock into resulting_stock;

      insert into public.product_stock_movements (
        product_id, quantity_delta, resulting_stock, reason, order_id, created_by
      ) values (
        stock_item.product_id,
        stock_item.restore_quantity,
        resulting_stock,
        'order_restore',
        p_order_id,
        auth.uid()
      );
      stock_was_restored := true;
    end loop;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'cancelled', true,
    'changed', true,
    'reason', normalized_reason,
    'cancelled_at', cancellation_time,
    'stock_restored', stock_was_restored
  );
end;
$function$;

comment on function public.cancel_order(bigint, text) is
  'Cancela pedido de forma idempotente e restaura lanches somente quando ainda pendente.';

create or replace function public.restock_snack_product(
  p_product_id bigint,
  p_quantity integer,
  p_operation_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_product public.products%rowtype;
  existing_movement public.product_stock_movements%rowtype;
  new_stock integer;
  normalized_note text := nullif(btrim(p_note), '');
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using errcode = '42501', message = 'Somente gestores podem repor estoque';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'Identificador da operacao e obrigatorio';
  end if;
  if p_quantity is null or p_quantity not between 1 and 999 then
    raise exception using errcode = '22023', message = 'A quantidade deve estar entre 1 e 999';
  end if;
  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres';
  end if;

  -- Serializa repeticoes concorrentes da mesma operacao antes da consulta.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select * into existing_movement
  from public.product_stock_movements
  where operation_id = p_operation_id;
  if found then
    if existing_movement.product_id = p_product_id
       and existing_movement.quantity_delta = p_quantity
       and existing_movement.reason = 'manual_restock'
       and existing_movement.note is not distinct from normalized_note then
      return jsonb_build_object(
        'product_id', p_product_id,
        'stock', existing_movement.resulting_stock,
        'changed', false
      );
    end if;
    raise exception using errcode = '22023', message = 'Identificador de operacao reutilizado com outros dados';
  end if;

  select * into selected_product
  from public.products
  where id = p_product_id
  for update;
  if not found or selected_product.category <> 'lanches' then
    raise exception using errcode = '22023', message = 'Produto nao e um lanche valido';
  end if;
  if coalesce(selected_product.stock, 0) + p_quantity > 9999 then
    raise exception using errcode = '22023', message = 'O estoque total nao pode ultrapassar 9999';
  end if;

  update public.products
  set stock = coalesce(stock, 0) + p_quantity
  where id = p_product_id
  returning stock into new_stock;

  insert into public.product_stock_movements (
    product_id, quantity_delta, resulting_stock, reason, note, created_by, operation_id
  ) values (
    p_product_id, p_quantity, new_stock, 'manual_restock', normalized_note, auth.uid(), p_operation_id
  );

  return jsonb_build_object('product_id', p_product_id, 'stock', new_stock, 'changed', true);
end;
$function$;

create or replace function public.set_snack_min_stock(
  p_product_id bigint,
  p_min_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  updated_stock integer;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using errcode = '42501', message = 'Somente gestores podem definir estoque minimo';
  end if;
  if p_min_stock is null or p_min_stock not between 0 and 999 then
    raise exception using errcode = '22023', message = 'O estoque minimo deve estar entre 0 e 999';
  end if;

  update public.products
  set min_stock = p_min_stock,
      stock = coalesce(stock, 0)
  where id = p_product_id and category = 'lanches'
  returning stock into updated_stock;
  if not found then
    raise exception using errcode = '22023', message = 'Produto nao e um lanche valido';
  end if;

  return jsonb_build_object('product_id', p_product_id, 'min_stock', p_min_stock, 'stock', updated_stock);
end;
$function$;

revoke all on function public.place_order(text, text, jsonb, text, numeric) from public;
revoke all on function public.place_order(text, text, jsonb, text, numeric) from anon;
grant execute on function public.place_order(text, text, jsonb, text, numeric) to authenticated;

revoke all on function public.cancel_order(bigint, text) from public;
revoke all on function public.cancel_order(bigint, text) from anon;
grant execute on function public.cancel_order(bigint, text) to authenticated;

revoke all on function public.restock_snack_product(bigint, integer, uuid, text) from public, anon;
grant execute on function public.restock_snack_product(bigint, integer, uuid, text) to authenticated;
revoke all on function public.set_snack_min_stock(bigint, integer) from public, anon;
grant execute on function public.set_snack_min_stock(bigint, integer) to authenticated;

revoke insert, update, delete on table public.product_stock_movements from anon, authenticated;
grant select on table public.product_stock_movements to authenticated;

drop policy if exists "product stock movements manager read" on public.product_stock_movements;
create policy "product stock movements manager read"
  on public.product_stock_movements
  for select
  to authenticated
  using (public.is_manager());
