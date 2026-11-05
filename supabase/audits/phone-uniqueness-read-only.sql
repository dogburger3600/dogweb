-- Auditoria somente leitura: normalização e unicidade de telefone em profiles.
-- Não altera dados, funções, triggers, índices, políticas ou usuários.

-- 1. Restrições e índices relacionados a public.profiles.
select tc.constraint_name,
       tc.constraint_type,
       pg_get_constraintdef(c.oid) as definition
from information_schema.table_constraints tc
join pg_namespace n on n.nspname = tc.table_schema
join pg_class r on r.relnamespace = n.oid and r.relname = tc.table_name
join pg_constraint c on c.conrelid = r.oid and c.conname = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'profiles'
order by tc.constraint_name;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'profiles'
order by indexname;

-- 2. Triggers efetivos em auth.users e public.profiles.
select table_namespace.nspname as table_schema,
       table_class.relname as table_name,
       trigger.tgname as trigger_name,
       function_namespace.nspname as function_schema,
       function.proname as function_name,
       pg_get_triggerdef(trigger.oid) as trigger_definition
from pg_trigger trigger
join pg_class table_class on table_class.oid = trigger.tgrelid
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
join pg_proc function on function.oid = trigger.tgfoid
join pg_namespace function_namespace on function_namespace.oid = function.pronamespace
where not trigger.tgisinternal
  and (table_namespace.nspname, table_class.relname) in (('auth', 'users'), ('public', 'profiles'))
order by table_namespace.nspname, table_class.relname, trigger.tgname;

select n.nspname as function_schema,
       p.proname as function_name,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user', 'force_new_profile_customer_role')
order by p.proname;

-- 3. Colunas, RLS, policies e privilégios relevantes.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;

select n.nspname as table_schema,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'profiles';

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'profiles'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'profiles'
order by grantee, privilege_type;

select grantee, column_name, privilege_type
from information_schema.role_column_grants
where table_schema = 'public'
  and table_name = 'profiles'
order by grantee, column_name, privilege_type;

select routine_schema, routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('handle_new_user', 'force_new_profile_customer_role')
order by routine_name, grantee, privilege_type;

-- 4. Distribuição de formatos sem expor telefones completos.
with cleaned as (
  select id,
         regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as digits
  from public.profiles
), canonical as (
  select id,
         digits,
         case
           when length(digits) = 13 and left(digits, 2) = '55' then substr(digits, 3)
           when length(digits) = 11 then digits
           else null
         end as national
  from cleaned
)
select count(*) as profiles_total,
       count(*) filter (where length(digits) = 11) as national_11_digits,
       count(*) filter (where length(digits) = 13 and left(digits, 2) = '55') as country_code_55,
       count(*) filter (
         where national is null
            or national !~ '^[1-9]{2}9[0-9]{8}$'
            or national = repeat(left(national, 1), 11)
       ) as invalid_for_project_rule
from canonical;

-- 5. Duplicidades canônicas. O hash permite correlacionar linhas sem revelar o número.
with cleaned as (
  select id,
         regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as digits
  from public.profiles
), canonical as (
  select id,
         case
           when length(digits) = 13 and left(digits, 2) = '55' then substr(digits, 3)
           when length(digits) = 11 then digits
           else null
         end as national
  from cleaned
)
select md5(national) as phone_fingerprint,
       count(*) as occurrences,
       array_agg(id order by id) as profile_ids
from canonical
where national ~ '^[1-9]{2}9[0-9]{8}$'
group by national
having count(*) > 1;

-- 6. Integridade Auth/Profile e distribuição de roles, sem listar dados pessoais.
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from auth.users u left join public.profiles p on p.id = u.id where p.id is null) as users_without_profile,
  (select count(*) from public.profiles p left join auth.users u on u.id = p.id where u.id is null) as profiles_without_user;

select role, count(*) as profiles
from public.profiles
group by role
order by role;
