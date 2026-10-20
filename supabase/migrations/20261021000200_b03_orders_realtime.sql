-- B03: habilita apenas os eventos administrativos de pedidos no Supabase Realtime.
do $b03_realtime$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Publication supabase_realtime nao encontrada';
  end if;

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_status_history') then
    alter publication supabase_realtime add table public.order_status_history;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_cancellations') then
    alter publication supabase_realtime add table public.order_cancellations;
  end if;
end
$b03_realtime$;
