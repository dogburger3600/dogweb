-- B01: valida o contrato minimo observado no frontend antes das extensoes.
-- Esta migracao nao altera schema nem dados. Ela falha cedo se a base alvo
-- nao corresponder ao contrato que foi possivel comprovar no repositorio.

do $b01_preflight$
declare
  missing_relations text;
  missing_columns text;
begin
  select string_agg(required.relation_name, ', ' order by required.relation_name)
    into missing_relations
  from (
    values
      ('expenses'),
      ('order_items'),
      ('orders'),
      ('products'),
      ('profiles'),
      ('site_popup')
  ) as required(relation_name)
  where to_regclass(format('public.%I', required.relation_name)) is null;

  if missing_relations is not null then
    raise exception 'B01 interrompida: tabelas esperadas ausentes: %', missing_relations;
  end if;

  select string_agg(
           format('%I.%I', required.table_name, required.column_name),
           ', ' order by required.table_name, required.column_name
         )
    into missing_columns
  from (
    values
      ('orders', 'id'),
      ('orders', 'status'),
      ('orders', 'created_at'),
      ('products', 'id'),
      ('products', 'category'),
      ('products', 'stock'),
      ('products', 'min_stock'),
      ('profiles', 'id'),
      ('profiles', 'role'),
      ('site_popup', 'starts_at'),
      ('site_popup', 'ends_at')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns existing
    where existing.table_schema = 'public'
      and existing.table_name = required.table_name
      and existing.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'B01 interrompida: colunas esperadas ausentes: %', missing_columns;
  end if;
end
$b01_preflight$;

