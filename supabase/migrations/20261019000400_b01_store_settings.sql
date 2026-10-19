-- B01: configuracao singleton da loja, ainda sem integracao com o frontend.
-- Os valores sao referencias aprovadas; nao alteram checkout ou pedidos por si so.

create table if not exists public.store_settings (
  id smallint primary key default 1 check (id = 1),
  open_time time not null default time '18:00',
  close_time time not null default time '23:30',
  pause_enabled boolean not null default false,
  pause_start time,
  pause_end time,
  whatsapp text not null default '+55 (88) 99623-9679',
  instagram text not null default '@dogburgertaua',
  location_name text not null default 'Dog Burguer, Tauá/CE',
  latitude numeric(9,7) not null default -6.0074487 check (latitude between -90 and 90),
  longitude numeric(10,7) not null default -40.2952674 check (longitude between -180 and 180),
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  accepts_pix boolean not null default true,
  accepts_cash boolean not null default true,
  accepts_card boolean not null default true,
  delivery_eta_min integer not null default 30 check (delivery_eta_min between 1 and 240),
  delivery_eta_max integer not null default 50 check (delivery_eta_max between 1 and 240),
  pickup_eta_min integer not null default 20 check (pickup_eta_min between 1 and 240),
  pickup_eta_max integer not null default 35 check (pickup_eta_max between 1 and 240),
  delivery_fee numeric(10,2) not null default 5.00 check (delivery_fee >= 0),
  free_delivery_from numeric(10,2) not null default 15.00 check (free_delivery_from >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (open_time <> close_time),
  check (not pause_enabled or (pause_start is not null and pause_end is not null and pause_start <> pause_end)),
  check (delivery_enabled or pickup_enabled),
  check (accepts_pix or accepts_cash or accepts_card),
  check (delivery_eta_max >= delivery_eta_min),
  check (pickup_eta_max >= pickup_eta_min)
);

comment on table public.store_settings is
  'Parametros preparados para integracao futura; nao sao aplicados automaticamente ao checkout.';

insert into public.store_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.store_settings enable row level security;

