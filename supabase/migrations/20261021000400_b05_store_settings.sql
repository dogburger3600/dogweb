-- B05: configuracoes operacionais aplicadas pelo servidor.
alter table public.orders
  add column if not exists fulfillment_method text,
  add column if not exists subtotal numeric,
  add column if not exists delivery_fee numeric,
  add column if not exists total numeric,
  add column if not exists eta_min integer,
  add column if not exists eta_max integer;

alter table public.orders
  drop constraint if exists orders_fulfillment_method_check,
  add constraint orders_fulfillment_method_check check (fulfillment_method is null or fulfillment_method in ('delivery', 'pickup'));

create or replace function public.get_store_settings()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare settings public.store_settings%rowtype;
begin
  select * into settings from public.store_settings where id = 1;
  if not found then raise exception using errcode = 'P0002', message = 'Configurações da loja não encontradas'; end if;
  return jsonb_build_object('open_time', settings.open_time, 'close_time', settings.close_time,
    'pause_enabled', settings.pause_enabled, 'pause_start', settings.pause_start, 'pause_end', settings.pause_end,
    'whatsapp', settings.whatsapp, 'instagram', settings.instagram, 'location_name', settings.location_name,
    'latitude', settings.latitude, 'longitude', settings.longitude, 'delivery_enabled', settings.delivery_enabled,
    'pickup_enabled', settings.pickup_enabled, 'accepts_pix', settings.accepts_pix, 'accepts_cash', settings.accepts_cash,
    'accepts_card', settings.accepts_card, 'delivery_eta_min', settings.delivery_eta_min, 'delivery_eta_max', settings.delivery_eta_max,
    'pickup_eta_min', settings.pickup_eta_min, 'pickup_eta_max', settings.pickup_eta_max, 'delivery_fee', settings.delivery_fee,
    'free_delivery_from', settings.free_delivery_from);
end;
$function$;

create or replace function public.update_store_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare settings public.store_settings%rowtype;
begin
  if auth.uid() is null or not public.is_manager() then raise exception using errcode = '42501', message = 'Somente gestores podem atualizar configurações'; end if;
  if jsonb_typeof(p_settings) <> 'object' then raise exception using errcode = '22023', message = 'Configurações inválidas'; end if;
  if nullif(btrim(p_settings->>'whatsapp'), '') is null then
    raise exception using errcode = '22023', message = 'WhatsApp não pode ficar vazio';
  end if;
  if nullif(btrim(p_settings->>'instagram'), '') is null then
    raise exception using errcode = '22023', message = 'Instagram não pode ficar vazio';
  end if;
  if nullif(btrim(p_settings->>'location_name'), '') is null then
    raise exception using errcode = '22023', message = 'Localização não pode ficar vazia';
  end if;
  update public.store_settings set
    open_time = (p_settings->>'open_time')::time, close_time = (p_settings->>'close_time')::time,
    pause_enabled = coalesce((p_settings->>'pause_enabled')::boolean, false),
    pause_start = nullif(p_settings->>'pause_start','')::time, pause_end = nullif(p_settings->>'pause_end','')::time,
    whatsapp = btrim(p_settings->>'whatsapp'), instagram = btrim(p_settings->>'instagram'), location_name = btrim(p_settings->>'location_name'),
    latitude = (p_settings->>'latitude')::numeric, longitude = (p_settings->>'longitude')::numeric,
    delivery_enabled = (p_settings->>'delivery_enabled')::boolean, pickup_enabled = (p_settings->>'pickup_enabled')::boolean,
    accepts_pix = (p_settings->>'accepts_pix')::boolean, accepts_cash = (p_settings->>'accepts_cash')::boolean, accepts_card = (p_settings->>'accepts_card')::boolean,
    delivery_eta_min = (p_settings->>'delivery_eta_min')::integer, delivery_eta_max = (p_settings->>'delivery_eta_max')::integer,
    pickup_eta_min = (p_settings->>'pickup_eta_min')::integer, pickup_eta_max = (p_settings->>'pickup_eta_max')::integer,
    delivery_fee = (p_settings->>'delivery_fee')::numeric, free_delivery_from = (p_settings->>'free_delivery_from')::numeric,
    updated_by = auth.uid(), updated_at = now()
  where id = 1 returning * into settings;
  if settings.open_time = settings.close_time or (settings.pause_enabled and (settings.pause_start is null or settings.pause_end is null or settings.pause_start = settings.pause_end))
    or not (settings.delivery_enabled or settings.pickup_enabled) or not (settings.accepts_pix or settings.accepts_cash or settings.accepts_card)
    or settings.delivery_eta_max < settings.delivery_eta_min or settings.pickup_eta_max < settings.pickup_eta_min then
    raise exception using errcode = '22023', message = 'Configurações inválidas';
  end if;
  return public.get_store_settings();
end;
$function$;

revoke all on table public.store_settings from anon, authenticated;
revoke all on function public.get_store_settings() from public, anon;
grant execute on function public.get_store_settings() to authenticated, anon;
revoke all on function public.update_store_settings(jsonb) from public, anon;
grant execute on function public.update_store_settings(jsonb) to authenticated;

-- Nova assinatura B05. O retorno traz os snapshots calculados no servidor.
create or replace function public.place_order(p_customer_name text, p_note text, p_items jsonb, p_payment_method text, p_change_for numeric, p_fulfillment_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  new_order_id bigint; item jsonb; selected_product public.products%rowtype; requested_product_id bigint; requested_qty integer;
  order_address jsonb; order_total numeric := 0; normalized_change numeric := null; stock_item record; settings public.store_settings%rowtype;
  delivery_charge numeric := 0; current_time_local time; eta_low integer; eta_high integer;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'É necessário entrar na conta para fazer um pedido'; end if;
  if coalesce(char_length(btrim(p_customer_name)),0) < 2 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023', message='Pedido inválido'; end if;
  if p_payment_method is null or p_payment_method not in ('pix','credito','debito','dinheiro') then raise exception using errcode='22023', message='Forma de pagamento inválida'; end if;
  if p_fulfillment_method not in ('delivery','pickup') then raise exception using errcode='22023', message='Modalidade de recebimento inválida'; end if;
  select * into settings from public.store_settings where id=1 for update;
  if not found then raise exception using errcode='P0002', message='Configurações da loja não encontradas'; end if;
  current_time_local := (now() at time zone 'America/Fortaleza')::time;
  if (settings.open_time < settings.close_time and not (current_time_local >= settings.open_time and current_time_local < settings.close_time))
     or (settings.open_time > settings.close_time and not (current_time_local >= settings.open_time or current_time_local < settings.close_time)) then raise exception using errcode='22023', message='A loja está fechada no momento'; end if;
  if settings.pause_enabled and ((settings.pause_start < settings.pause_end and current_time_local >= settings.pause_start and current_time_local < settings.pause_end) or (settings.pause_start > settings.pause_end and (current_time_local >= settings.pause_start or current_time_local < settings.pause_end))) then raise exception using errcode='22023', message='A loja está em pausa no momento'; end if;
  if (p_payment_method='pix' and not settings.accepts_pix) or (p_payment_method='dinheiro' and not settings.accepts_cash) or (p_payment_method in ('credito','debito') and not settings.accepts_card) then raise exception using errcode='22023', message='Forma de pagamento indisponível'; end if;
  if p_fulfillment_method='delivery' then
    if not settings.delivery_enabled then raise exception using errcode='22023', message='Entrega indisponível'; end if;
    select jsonb_build_object('street',street,'number',address_number,'complement',address_complement,'neighborhood',neighborhood) into order_address from public.profiles where id=auth.uid() and nullif(btrim(street),'') is not null and nullif(btrim(address_number),'') is not null;
    if order_address is null then raise exception using errcode='22023', message='Endereço válido é obrigatório para entrega'; end if;
    eta_low:=settings.delivery_eta_min; eta_high:=settings.delivery_eta_max;
  else
    if not settings.pickup_enabled then raise exception using errcode='22023', message='Retirada indisponível'; end if;
    order_address:=null; eta_low:=settings.pickup_eta_min; eta_high:=settings.pickup_eta_max;
  end if;
  if p_payment_method='dinheiro' then normalized_change:=p_change_for; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' then raise exception using errcode='22023',message='Produto indisponível'; end if;
    begin requested_product_id:=(item->>'product_id')::bigint; requested_qty:=(item->>'quantity')::integer; exception when others then raise exception using errcode='22023',message='Produto indisponível'; end;
    if requested_product_id is null or requested_product_id<=0 or requested_qty is null or requested_qty<=0 then raise exception using errcode='22023',message='Produto indisponível'; end if;
  end loop;
  perform products.id from public.products products join (select distinct (raw_item->>'product_id')::bigint product_id from jsonb_array_elements(p_items) raw_item) requested on requested.product_id=products.id order by products.id for update of products;
  for item in select * from jsonb_array_elements(p_items) loop
    requested_product_id:=(item->>'product_id')::bigint; requested_qty:=(item->>'quantity')::integer;
    select * into selected_product from public.products where id=requested_product_id and active=true;
    if not found then raise exception using errcode='22023',message='Produto indisponível'; end if;
  end loop;
  for stock_item in select products.id product_id,products.name,coalesce(products.stock,0) stock,sum((raw_item->>'quantity')::integer)::integer requested_quantity from jsonb_array_elements(p_items) raw_item join public.products products on products.id=(raw_item->>'product_id')::bigint where products.category='lanches' group by products.id,products.name,products.stock order by products.id loop
    if stock_item.stock<stock_item.requested_quantity then raise exception using errcode='23514',message=format('Estoque insuficiente para %s: disponível %s, solicitado %s',stock_item.name,stock_item.stock,stock_item.requested_quantity); end if;
  end loop;
  for item in select * from jsonb_array_elements(p_items) loop requested_product_id:=(item->>'product_id')::bigint; requested_qty:=(item->>'quantity')::integer; select * into selected_product from public.products where id=requested_product_id; order_total:=order_total+(selected_product.price*requested_qty); end loop;
  if p_fulfillment_method='delivery' and order_total<settings.free_delivery_from then delivery_charge:=settings.delivery_fee; end if;
  if normalized_change is not null and normalized_change < order_total+delivery_charge then raise exception using errcode='22023',message='O valor para troco deve ser igual ou maior que o total do pedido'; end if;
  insert into public.orders(customer_id,customer_name,note,delivery_address,payment_method,change_for,fulfillment_method,subtotal,delivery_fee,total,eta_min,eta_max) values(auth.uid(),btrim(p_customer_name),coalesce(btrim(p_note),''),order_address,p_payment_method,normalized_change,p_fulfillment_method,order_total,delivery_charge,order_total+delivery_charge,eta_low,eta_high) returning id into new_order_id;
  for item in select * from jsonb_array_elements(p_items) loop requested_product_id:=(item->>'product_id')::bigint; requested_qty:=(item->>'quantity')::integer; select * into selected_product from public.products where id=requested_product_id; insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,unit_cost,removed_ingredients) values(new_order_id,selected_product.id,selected_product.name,requested_qty,selected_product.price,selected_product.cost,left(coalesce(btrim(item->>'removed_ingredients'),''),120)); end loop;
  for stock_item in select products.id product_id,sum((raw_item->>'quantity')::integer)::integer requested_quantity from jsonb_array_elements(p_items) raw_item join public.products products on products.id=(raw_item->>'product_id')::bigint where products.category='lanches' group by products.id order by products.id loop update public.products set stock=coalesce(stock,0)-stock_item.requested_quantity where id=stock_item.product_id returning stock into selected_product.stock; insert into public.product_stock_movements(product_id,quantity_delta,resulting_stock,reason,order_id,created_by) values(stock_item.product_id,-stock_item.requested_quantity,selected_product.stock,'order_debit',new_order_id,auth.uid()); end loop;
  return jsonb_build_object('order_id',new_order_id,'fulfillment_method',p_fulfillment_method,'subtotal',order_total,'delivery_fee',delivery_charge,'total',order_total+delivery_charge,'eta_min',eta_low,'eta_max',eta_high);
end;
$function$;

-- Ponte temporária para o frontend B04: todas as regras B05 continuam executadas.
create or replace function public.place_order(p_customer_name text,p_note text,p_items jsonb,p_payment_method text,p_change_for numeric default null::numeric)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $function$
declare result jsonb;
begin
  result:=public.place_order(p_customer_name,p_note,p_items,p_payment_method,p_change_for,'delivery');
  return (result->>'order_id')::bigint;
end;
$function$;
revoke all on function public.place_order(text,text,jsonb,text,numeric,text) from public, anon;
grant execute on function public.place_order(text,text,jsonb,text,numeric,text) to authenticated;
