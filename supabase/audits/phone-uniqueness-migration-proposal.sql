-- PROPOSTA PARA REVISÃO — NÃO EXECUTAR SEM AUTORIZAÇÃO E BACKUP.
-- Objetivo: normalizar novos telefones e preservar a unicidade por número canônico.
-- Não modifica os telefones existentes, usuários, perfis, roles, RLS ou handle_new_user().

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Trava fail-closed: substitua somente após revisar a auditoria read-only e autorizar.
do $confirmation$
declare
  confirmation_text constant text := 'REVIEW_REQUIRED';
begin
  if confirmation_text <> 'PHONE_MIGRATION_AUTHORIZED' then
    raise exception using
      errcode = 'P0001',
      message = 'PHONE_MIGRATION_ABORTED: autorização explícita ausente';
  end if;
end;
$confirmation$;

create or replace function public.normalize_br_mobile_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  with input as (
    select trim(coalesce(p_phone, '')) as raw_value
  ), cleaned as (
    select
      raw_value,
      regexp_replace(raw_value, '[^0-9]', '', 'g') as digits
    from input
  ), national as (
    select case
      when raw_value = '' or raw_value !~ '^\+?[0-9() -]+$' then null
      when left(raw_value, 1) = '+'
        and not (length(digits) = 13 and left(digits, 2) = '55') then null
      when length(digits) = 13 and left(digits, 2) = '55' then substr(digits, 3)
      when length(digits) = 11 then digits
      else null
    end as value
    from cleaned
  )
  select case
    when value ~ '^[1-9]{2}9[0-9]{8}$'
      and left(value, 2) = any(array[
        '11', '12', '13', '14', '15', '16', '17', '18', '19',
        '21', '22', '24', '27', '28',
        '31', '32', '33', '34', '35', '37', '38',
        '41', '42', '43', '44', '45', '46', '47', '48', '49',
        '51', '53', '54', '55',
        '61', '62', '63', '64', '65', '66', '67', '68', '69',
        '71', '73', '74', '75', '77', '79',
        '81', '82', '83', '84', '85', '86', '87', '88', '89',
        '91', '92', '93', '94', '95', '96', '97', '98', '99'
      ]::text[])
      and value <> repeat(left(value, 1), 11)
    then value
    else null
  end
  from national
$function$;

revoke all on function public.normalize_br_mobile_phone(text) from public, anon, authenticated;

-- Chave exclusiva para o índice. Celulares válidos usam o namespace mobile e
-- são comparados pelo número canônico. Valores legados permanecem no namespace
-- legacy, com seu conteúdo original, sem inferir equivalência com um celular.
-- Novos inserts e alterações de phone inválidos são bloqueados pelo trigger.
create or replace function public.profile_phone_uniqueness_key(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  with input as (
    select trim(coalesce(p_phone, '')) as raw_value
  ), normalized as (
    select
      raw_value,
      public.normalize_br_mobile_phone(raw_value) as canonical_phone
    from input
  )
  select case
    when canonical_phone is not null then 'mobile:' || canonical_phone
    else 'legacy:' || raw_value
  end
  from normalized
$function$;

revoke all on function public.profile_phone_uniqueness_key(text) from public, anon, authenticated;

-- Autoteste SQL da mesma matriz de formatos e DDDs usada por js/phone.js.
do $normalizer_self_test$
declare
  ddd text;
  canonical text;
  formatted text;
begin
  foreach ddd in array array[
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99'
  ]::text[] loop
    canonical := ddd || '912345678';
    formatted := '+55 (' || ddd || ') 91234-5678';
    if public.normalize_br_mobile_phone(canonical) is distinct from canonical
      or public.normalize_br_mobile_phone(formatted) is distinct from canonical then
      raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: divergência no autoteste de DDD válido';
    end if;
  end loop;

  if exists (
    select 1
    from unnest(array[
      null::text, '', '10912345678', '23912345678', '90912345678',
      '88123456789', '+54 11 91234-5678', '+88 99999-9999',
      'abc88999999999', '88.99999.9999', '88/99999-9999',
      '88+99999-9999', E'88\t99999-9999'
    ]) as invalid_phone(value)
    where public.normalize_br_mobile_phone(value) is not null
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: divergência no autoteste de telefone inválido';
  end if;

  if public.profile_phone_uniqueness_key('8833334444')
      is not distinct from public.profile_phone_uniqueness_key('88933334444')
    or public.profile_phone_uniqueness_key('8833334444')
      is distinct from 'legacy:8833334444'
    or public.profile_phone_uniqueness_key('88933334444')
      is distinct from 'mobile:88933334444' then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: isolamento de telefone legado divergente';
  end if;
end;
$normalizer_self_test$;

-- Evita corrida entre o preflight, a criação do índice e a instalação do trigger.
-- Com seis perfis, a janela esperada é curta; lock_timeout impede espera indefinida.
lock table public.profiles in share row exclusive mode;

-- Aborta sem mudanças se os seis perfis atuais exigirem decisão manual.
do $preflight$
begin
  if to_regclass('public.profiles_phone_canonical_key') is not null then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: profiles_phone_canonical_key surgiu após a auditoria; revise sua definição antes de prosseguir';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_phone_key'
      and contype = 'u'
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: profiles_phone_key ausente';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace function_namespace on function_namespace.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and t.tgname = 'on_auth_user_created'
      and t.tgenabled in ('O', 'A')
      and function_namespace.nspname = 'public'
      and p.proname = 'handle_new_user'
      and p.pronargs = 0
      and p.prorettype = 'trigger'::regtype
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: on_auth_user_created ausente, desabilitada ou incompatível';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace function_namespace on function_namespace.oid = p.pronamespace
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
      and t.tgname = 's01_force_customer_role_on_insert'
      and t.tgenabled in ('O', 'A')
      and function_namespace.nspname = 'public'
      and p.proname = 'force_new_profile_customer_role'
      and p.pronargs = 0
      and p.prorettype = 'trigger'::regtype
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: s01_force_customer_role_on_insert ausente, desabilitada ou incompatível';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = 'public.profiles'::regclass
      and c.relrowsecurity
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: RLS de profiles desabilitada';
  end if;

  if exists (
    select public.profile_phone_uniqueness_key(phone)
    from public.profiles
    group by public.profile_phone_uniqueness_key(phone)
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: existem chaves de telefone duplicadas';
  end if;
end;
$preflight$;

-- Mantém profiles_phone_key e acrescenta proteção para formatos equivalentes.
create unique index profiles_phone_canonical_key
on public.profiles (public.profile_phone_uniqueness_key(phone));

do $index_validation$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class index_class on index_class.oid = i.indexrelid
    where index_class.relnamespace = 'public'::regnamespace
      and index_class.relname = 'profiles_phone_canonical_key'
      and i.indrelid = 'public.profiles'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indpred is null
      and i.indnkeyatts = 1
      and i.indnatts = 1
      and pg_get_expr(i.indexprs, i.indrelid)
        ~ '^(public\.)?profile_phone_uniqueness_key\(phone\)$'
  ) then
    raise exception using errcode = 'P0001', message = 'PHONE_MIGRATION_ABORTED: índice canônico incompatível';
  end if;
end;
$index_validation$;

create or replace function public.enforce_canonical_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  canonical_phone text;
begin
  canonical_phone := public.normalize_br_mobile_phone(new.phone);
  if canonical_phone is null then
    raise exception using errcode = '22023', message = 'Telefone invalido';
  end if;
  new.phone := canonical_phone;
  return new;
end;
$function$;

drop trigger if exists s01_enforce_canonical_profile_phone on public.profiles;
create trigger s01_enforce_canonical_profile_phone
before insert or update of phone on public.profiles
for each row execute function public.enforce_canonical_profile_phone();

revoke all on function public.enforce_canonical_profile_phone() from public, anon, authenticated;

commit;

-- Rollback dos objetos adicionados, caso seja necessário após uma execução autorizada:
-- begin;
-- drop trigger if exists s01_enforce_canonical_profile_phone on public.profiles;
-- drop index if exists public.profiles_phone_canonical_key;
-- drop function if exists public.enforce_canonical_profile_phone();
-- drop function if exists public.profile_phone_uniqueness_key(text);
-- drop function if exists public.normalize_br_mobile_phone(text);
-- commit;
