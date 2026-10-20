-- B03: habilita somente as tabelas administrativas necessárias no Realtime.
alter publication supabase_realtime add table
  public.orders,
  public.order_status_history,
  public.order_cancellations;

