-- B06: fonte financeira autoritativa para os relatorios administrativos.
create or replace function public.get_manager_report(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  period_start timestamptz;
  period_end timestamptz;
  response jsonb;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception using errcode = '42501', message = 'Somente gestores podem consultar relatorios';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception using errcode = '22004', message = 'Data inicial e data final sao obrigatorias';
  end if;

  if p_start_date > p_end_date then
    raise exception using errcode = '22023', message = 'O periodo do relatorio e invalido';
  end if;

  period_start := p_start_date::timestamp at time zone 'America/Fortaleza';
  period_end := (p_end_date + 1)::timestamp at time zone 'America/Fortaleza';

  with item_rollup as (
    select
      items.order_id,
      coalesce(sum(items.unit_price * items.quantity), 0) as item_revenue,
      coalesce(sum(items.unit_cost * items.quantity) filter (where items.unit_cost is not null), 0) as known_cost,
      count(*) as item_count,
      count(*) filter (where items.unit_cost is not null) as items_with_unit_cost,
      count(*) filter (where items.unit_cost is null) as items_without_unit_cost,
      coalesce(jsonb_agg(jsonb_build_object(
        'product_name', items.product_name,
        'quantity', items.quantity,
        'unit_price', items.unit_price,
        'line_total', items.unit_price * items.quantity,
        'removed_ingredients', coalesce(items.removed_ingredients, '')
      ) order by items.product_id, items.product_name), '[]'::jsonb) as items
    from public.order_items items
    group by items.order_id
  ),
  eligible_orders as (
    select
      orders.*,
      delivered.delivered_at,
      coalesce(delivered.delivered_at, orders.created_at) as recognized_at,
      case when delivered.delivered_at is null then 'orders_created_at_fallback' else 'delivered_event' end as recognition_source
    from public.orders orders
    left join lateral (
      select min(history.created_at) as delivered_at
      from public.order_status_history history
      where history.order_id = orders.id
        and history.to_status = 'entregue'
    ) delivered on true
    where orders.status = 'entregue'
      and not exists (
        select 1
        from public.order_cancellations cancellation
        where cancellation.order_id = orders.id
      )
  ),
  sales as (
    select
      eligible.id,
      eligible.customer_name,
      eligible.payment_method,
      eligible.fulfillment_method,
      eligible.recognized_at,
      eligible.recognition_source,
      eligible.total,
      eligible.subtotal,
      eligible.delivery_fee,
      coalesce(items.item_revenue, 0) as item_revenue,
      coalesce(eligible.total, items.item_revenue, 0) as revenue,
      coalesce(eligible.subtotal, items.item_revenue, 0) as products_revenue,
      case when eligible.total is not null then coalesce(eligible.delivery_fee, 0) else 0 end as known_delivery_revenue,
      coalesce(items.known_cost, 0) as known_cost,
      coalesce(items.item_count, 0) as item_count,
      coalesce(items.items_with_unit_cost, 0) as items_with_unit_cost,
      coalesce(items.items_without_unit_cost, 0) as items_without_unit_cost,
      coalesce(items.items, '[]'::jsonb) as items,
      (eligible.total is not null and eligible.subtotal is not null and eligible.delivery_fee is not null) as has_complete_b05_snapshot
    from eligible_orders eligible
    left join item_rollup items on items.order_id = eligible.id
    where eligible.recognized_at >= period_start
      and eligible.recognized_at < period_end
  ),
  sales_summary as (
    select
      count(*) as sales_count,
      coalesce(sum(revenue), 0) as revenue,
      coalesce(sum(products_revenue), 0) as products_revenue,
      coalesce(sum(known_delivery_revenue), 0) as delivery_revenue,
      coalesce(sum(known_cost), 0) as product_cost,
      count(*) filter (where total is not null) as orders_using_b05_total,
      count(*) filter (where total is null) as orders_using_item_total_fallback,
      count(*) filter (where recognition_source = 'delivered_event') as orders_using_delivered_event,
      count(*) filter (where recognition_source = 'orders_created_at_fallback') as orders_using_created_at_fallback,
      coalesce(sum(items_with_unit_cost), 0) as items_with_unit_cost,
      coalesce(sum(items_without_unit_cost), 0) as items_without_unit_cost,
      count(*) filter (where not has_complete_b05_snapshot) as orders_without_complete_b05_snapshot
    from sales
  ),
  expense_summary as (
    select count(*) as expense_count, coalesce(sum(expenses.amount), 0) as expenses
    from public.expenses expenses
    where expenses.created_at >= period_start
      and expenses.created_at < period_end
  ),
  order_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', sales.id,
      'customer_name', sales.customer_name,
      'payment_method', sales.payment_method,
      'fulfillment_method', sales.fulfillment_method,
      'recognized_at', sales.recognized_at,
      'recognized_at_label', to_char(sales.recognized_at at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
      'recognition_source', sales.recognition_source,
      'revenue', sales.revenue,
      'subtotal', case when sales.has_complete_b05_snapshot then sales.subtotal else null end,
      'delivery_fee', case when sales.has_complete_b05_snapshot then sales.delivery_fee else null end,
      'items', sales.items
    ) order by sales.recognized_at desc, sales.id desc), '[]'::jsonb) as orders
    from sales
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'timezone', 'America/Fortaleza',
      'start_inclusive', period_start,
      'end_exclusive', period_end
    ),
    'criteria', jsonb_build_object(
      'recognized_status', 'entregue',
      'cancelled_orders_excluded', true,
      'recognition_time', 'first_delivered_event_with_orders_created_at_fallback',
      'historical_total_fallback', 'sum_order_item_snapshots',
      'cost_source', 'order_items.unit_cost',
      'expense_date_source', 'expenses.created_at'
    ),
    'summary', jsonb_build_object(
      'sales_count', sales_summary.sales_count,
      'revenue', sales_summary.revenue,
      'products_revenue', sales_summary.products_revenue,
      'delivery_revenue', sales_summary.delivery_revenue,
      'product_cost', sales_summary.product_cost,
      'expenses', expense_summary.expenses,
      'expense_count', expense_summary.expense_count,
      'result', sales_summary.revenue - sales_summary.product_cost - expense_summary.expenses,
      'average_ticket', case when sales_summary.sales_count = 0 then 0 else sales_summary.revenue / sales_summary.sales_count end
    ),
    'orders', order_result.orders,
    'coverage', jsonb_build_object(
      'realized_sales', sales_summary.sales_count,
      'orders_using_b05_total', sales_summary.orders_using_b05_total,
      'orders_using_item_total_fallback', sales_summary.orders_using_item_total_fallback,
      'orders_using_delivered_event', sales_summary.orders_using_delivered_event,
      'orders_using_created_at_fallback', sales_summary.orders_using_created_at_fallback,
      'items_with_unit_cost', sales_summary.items_with_unit_cost,
      'items_without_unit_cost', sales_summary.items_without_unit_cost,
      'orders_without_complete_b05_snapshot', sales_summary.orders_without_complete_b05_snapshot
    )
  ) into response
  from sales_summary
  cross join expense_summary
  cross join order_result;

  return response;
end;
$function$;

comment on function public.get_manager_report(date, date) is
  'B06: relatorio financeiro de vendas entregues e nao canceladas em America/Fortaleza.';

revoke all on function public.get_manager_report(date, date) from public, anon, authenticated;
grant execute on function public.get_manager_report(date, date) to authenticated;
