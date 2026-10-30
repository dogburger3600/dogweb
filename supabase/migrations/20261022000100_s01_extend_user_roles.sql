-- S01/1: novos valores do enum em migration isolada.
-- PostgreSQL exige commit antes que valores novos sejam usados com seguranca.
alter type public.user_role add value if not exists 'owner';
alter type public.user_role add value if not exists 'attendant';
