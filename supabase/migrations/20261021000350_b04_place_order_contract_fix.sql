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
  requested_product_id bigint;
  requested_qty integer;
  order_address jsonb;
  order_total numeric := 0;
  normalized_change numeric := null;
  stock_item record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'É necessário entrar na conta para fazer um pedido';
  end if;
  if coalesce(char_length(btrim(p_customer_name)), 0) < 2
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'Pedido inválido';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('pix', 'credito', 'debito', 'dinheiro') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida';
  end if;
  if p_payment_method = 'dinheiro' then normalized_change := p_change_for; end if;

  select jsonb_build_object('street', street, 'number', address_number, 'complement', address_complement, 'neighborhood', neighborhood)
    into order_address
  from public.profiles where id = auth.uid();
  if order_address is null then
    raise exception using errcode = 'P0002', message = 'Perfil do cliente não encontrado';
  end if;

  -- Valida o formato antes dos casts usados para determinar os locks.
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception using errcode = '22023', message = 'Produto indisponível';
    end if;
    begin
      requested_product_id := (item->>'product_id')::bigint;
      requested_qty := (item->>'quantity')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'Produto indisponível';
    end;
    if requested_product_id is null or requested_product_id <= 0
       or requested_qty is null or requested_qty <= 0 then
      raise exception using errcode = '22023', message = 'Produto indisponível';
    end if;
  end loop;

  -- Bloqueia todas as linhas envolvidas em ordem de id para evitar deadlocks.
  perform products.id
  from public.products products
  join (
    select distinct (raw_item->>'product_id')::bigint as product_id
    from jsonb_array_elements(p_items) raw_item
  ) requested on requested.product_id = products.id
  order by products.id
  for update of products;

  -- Toda validacao ocorre antes de qualquer insert; qualquer excecao reverte a transacao inteira.
  for item in select * from jsonb_array_elements(p_items) loop
    requested_product_id := (item->>'product_id')::bigint;
    requested_qty := (item->>'quantity')::integer;
    select * into selected_product from public.products
      where id = requested_product_id and active = true;
    if not found then
      raise exception using errcode = '22023', message = 'Produto indisponível';
    end if;
  end loop;

  -- So lanches prontos participam do saldo transacional; itens repetidos sao consolidados.
  for stock_item in
    select products.id as product_id, products.name,
           coalesce(products.stock, 0) as stock,
           sum((raw_item->>'quantity')::integer)::integer as requested_quantity
    from jsonb_array_elements(p_items) raw_item
    join public.products products on products.id = (raw_item->>'product_id')::bigint
    where products.category = 'lanches'
    group by products.id, products.name, products.stock
    order by products.id
  loop
    if stock_item.stock < stock_item.requested_quantity then
      raise exception using errcode = '23514', message = format('Estoque insuficiente para %s: disponível %s, solicitado %s', stock_item.name, stock_item.stock, stock_item.requested_quantity);
    end if;
  end loop;

  for item in select * from jsonb_array_elements(p_items) loop
    requested_product_id := (item->>'product_id')::bigint;
    requested_qty := (item->>'quantity')::integer;
    select * into selected_product from public.products where id = requested_product_id;
    order_total := order_total + (selected_product.price * requested_qty);
  end loop;
  if normalized_change is not null and normalized_change < order_total then
    raise exception using errcode = '22023', message = 'O valor para troco deve ser igual ou maior que o total do pedido';
  end if;

  insert into public.orders (customer_id, customer_name, note, delivery_address, payment_method, change_for)
  values (auth.uid(), btrim(p_customer_name), coalesce(btrim(p_note), ''), order_address, p_payment_method, normalized_change)
  returning id into new_order_id;

  for item in select * from jsonb_array_elements(p_items) loop
    requested_product_id := (item->>'product_id')::bigint;
    requested_qty := (item->>'quantity')::integer;
    select * into selected_product from public.products where id = requested_product_id;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost, removed_ingredients)
    values (new_order_id, selected_product.id, selected_product.name, requested_qty, selected_product.price, selected_product.cost, left(coalesce(btrim(item->>'removed_ingredients'), ''), 120));
  end loop;

  for stock_item in
    select products.id as product_id,
           sum((raw_item->>'quantity')::integer)::integer as requested_quantity
    from jsonb_array_elements(p_items) raw_item
    join public.products products on products.id = (raw_item->>'product_id')::bigint
    where products.category = 'lanches'
    group by products.id order by products.id
  loop
    update public.products
      set stock = coalesce(stock, 0) - stock_item.requested_quantity
      where id = stock_item.product_id
      returning stock into selected_product.stock;
    insert into public.product_stock_movements (product_id, quantity_delta, resulting_stock, reason, order_id, created_by)
    values (stock_item.product_id, -stock_item.requested_quantity, selected_product.stock, 'order_debit', new_order_id, auth.uid());
  end loop;
  return new_order_id;
end;
$function$;
