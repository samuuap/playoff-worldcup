-- ============================================================================
-- QUINIELA MUNDIAL — Esquema Supabase
-- Modelo: cada usuario predice el CUADRO COMPLETO desde el inicio.
--         Cada predicción se cierra a la hora real de su partido (kickoff_at).
-- Ejecuta este script entero en  Supabase  ->  SQL Editor  ->  New query.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PERFILES  (extiende auth.users con nombre visible y rol admin)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. PARTIDOS  (cada fila = una RANURA fija del cuadro, no el cruce del usuario)
--    Para R32 los equipos son reales (team_a / team_b).
--    Para rondas superiores, los participantes salen de los picks del usuario;
--    feeder_a / feeder_b indican qué ranuras alimentan a esta.
-- ----------------------------------------------------------------------------
create table if not exists public.matches (
  id            text primary key,                 -- 'R32-01', 'R16-03', 'QF-1', 'SF-1', 'F'
  round         text not null check (round in ('R32','R16','QF','SF','F')),
  position      int  not null,                    -- orden dentro de la ronda (1..n)
  points        int  not null,                    -- puntos por acertar esta ranura
  kickoff_at    timestamptz not null,             -- a partir de aquí el pick se cierra
  team_a        text,                             -- solo R32: equipo real
  team_b        text,                             -- solo R32: equipo real
  feeder_a      text references public.matches(id),
  feeder_b      text references public.matches(id),
  actual_winner text,                             -- lo rellena el admin tras el partido
  conditional   boolean not null default false,   -- true = se puntúa según el SIGUIENTE partido
  created_at    timestamptz not null default now()
);
create index if not exists matches_round_pos_idx on public.matches (round, position);

-- ----------------------------------------------------------------------------
-- 3. PICKS  (la predicción de cada usuario para cada ranura)
-- ----------------------------------------------------------------------------
create table if not exists public.picks (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  match_id         text not null references public.matches(id)  on delete cascade,
  predicted_winner text not null,
  updated_at       timestamptz not null default now(),
  primary key (user_id, match_id)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.matches  enable row level security;
alter table public.picks    enable row level security;

-- Perfiles: todos ven los nombres (para el ranking); cada quien edita el suyo.
drop policy if exists "perfiles_select" on public.profiles;
create policy "perfiles_select" on public.profiles for select using (true);
drop policy if exists "perfiles_update_own" on public.profiles;
create policy "perfiles_update_own" on public.profiles for update
  using (auth.uid() = id);

-- Partidos: lectura para autenticados; escritura solo admin.
drop policy if exists "matches_select" on public.matches;
create policy "matches_select" on public.matches for select
  using (auth.role() = 'authenticated');
drop policy if exists "matches_admin_all" on public.matches;
create policy "matches_admin_all" on public.matches for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Picks: cada quien ve / borra los suyos.
drop policy if exists "picks_select_own" on public.picks;
create policy "picks_select_own" on public.picks for select using (auth.uid() = user_id);
drop policy if exists "picks_delete_own" on public.picks;
create policy "picks_delete_own" on public.picks for delete using (auth.uid() = user_id);

-- ►► EL CIERRE DE APUESTAS, BLINDADO EN LA BASE DE DATOS ◄◄
-- Solo se puede crear/editar un pick si AÚN no ha empezado el partido.
drop policy if exists "picks_insert_before_kickoff" on public.picks;
create policy "picks_insert_before_kickoff" on public.picks for insert
  with check (
    auth.uid() = user_id
    and now() < (select m.kickoff_at from public.matches m where m.id = match_id)
  );
drop policy if exists "picks_update_before_kickoff" on public.picks;
create policy "picks_update_before_kickoff" on public.picks for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and now() < (select m.kickoff_at from public.matches m where m.id = match_id)
  );

-- ============================================================================
-- 4. CLASIFICACIÓN  (suma global; SECURITY DEFINER para poder agregar a todos
--    los usuarios sin exponer los picks individuales)
-- ============================================================================
create or replace function public.leaderboard()
returns table (user_id uuid, username text, points bigint, aciertos int, resueltos int)
language sql
security definer set search_path = public
as $$
  with parent as (   -- para cada partido, cuál es su "siguiente" (al que alimenta)
    select c.id as child_id, p.id as parent_id
    from public.matches c
    join public.matches p on (p.feeder_a = c.id or p.feeder_b = c.id)
  ),
  per_pick as (
    select
      pk.user_id,
      m.points,
      -- ¿acierto?  normal: el propio partido.  condicional: el siguiente partido.
      case
        when m.points = 0 then false
        when m.conditional = false then (m.actual_winner is not null and pk.predicted_winner = m.actual_winner)
        else (pm.actual_winner is not null and ppk.predicted_winner = pm.actual_winner)
      end as is_hit,
      case
        when m.conditional = false then (m.actual_winner is not null)
        else (pm.actual_winner is not null)
      end as is_resolved
    from public.picks pk
    join public.matches m on m.id = pk.match_id
    left join parent par on par.child_id = m.id
    left join public.matches pm on pm.id = par.parent_id
    left join public.picks ppk on ppk.user_id = pk.user_id and ppk.match_id = par.parent_id
  )
  select
    pr.id, pr.username,
    coalesce(sum(case when pp.is_hit then pp.points else 0 end), 0)::bigint as points,
    coalesce(count(*) filter (where pp.is_hit), 0)::int       as aciertos,
    coalesce(count(*) filter (where pp.is_resolved), 0)::int  as resueltos
  from public.profiles pr
  left join per_pick pp on pp.user_id = pr.id
  group by pr.id, pr.username
  order by points desc, aciertos desc, pr.username;
$$;
grant execute on function public.leaderboard() to authenticated;

-- ============================================================================
-- 5. SEED DE EJEMPLO  (★ reemplaza por tu árbol real ★)
--    32 equipos de marcador de posición, escala 1/2/4/8/16 y horarios relativos
--    a "ahora" para que veas en vivo partidos cerrados, abiertos y ya puntuados.
-- ============================================================================
truncate table public.picks;
delete from public.matches;

-- R32: 16 cruces reales (tu árbol). Ajusta kickoff_at a las horas reales de cada partido.
insert into public.matches (id, round, position, points, kickoff_at, team_a, team_b) values
 ('R32-01','R32', 1,1, now()+interval  '4 hours', 'Alemania',       'Paraguay'),
 ('R32-02','R32', 2,1, now()+interval  '8 hours', 'Francia',        'Suecia'),
 ('R32-03','R32', 3,1, now()+interval '12 hours', 'Sudáfrica',      'Canadá'),
 ('R32-04','R32', 4,1, now()+interval '16 hours', 'Países Bajos',   'Marruecos'),
 ('R32-05','R32', 5,1, now()+interval '20 hours', 'Portugal',       'Croacia'),
 ('R32-06','R32', 6,1, now()+interval '24 hours', 'España',         'Austria'),
 ('R32-07','R32', 7,1, now()+interval '28 hours', 'Estados Unidos', 'Rusia'),
 ('R32-08','R32', 8,1, now()+interval '32 hours', 'Bélgica',        'Senegal'),
 ('R32-09','R32', 9,1, now()+interval '36 hours', 'Brasil',         'Japón'),
 ('R32-10','R32',10,1, now()+interval '40 hours', 'Costa de Marfil','Noruega'),
 ('R32-11','R32',11,1, now()+interval '44 hours', 'México',         'Ecuador'),
 ('R32-12','R32',12,1, now()+interval '48 hours', 'Inglaterra',     'Corea del Sur'),
 ('R32-13','R32',13,1, now()+interval '52 hours', 'Argentina',      'Cabo Verde'),
 ('R32-14','R32',14,1, now()+interval '56 hours', 'Australia',      'Egipto'),
 ('R32-15','R32',15,1, now()+interval '60 hours', 'Suiza',          'Argelia'),
 ('R32-16','R32',16,1, now()+interval '64 hours', 'Colombia',       'Ghana');

-- R16: 8 ranuras, alimentadas por pares de R32.
insert into public.matches (id, round, position, points, kickoff_at, feeder_a, feeder_b)
select
  'R16-' || lpad(g::text,2,'0'),
  'R16', g, 2,
  now() + interval '4 days' + (g * interval '6 hours'),
  'R32-' || lpad((2*g-1)::text,2,'0'),
  'R32-' || lpad((2*g)::text,2,'0')
from generate_series(1,8) g;

-- Cuartos: 4 ranuras.
insert into public.matches (id, round, position, points, kickoff_at, feeder_a, feeder_b)
select
  'QF-' || g, 'QF', g, 4,
  now() + interval '8 days' + (g * interval '6 hours'),
  'R16-' || lpad((2*g-1)::text,2,'0'),
  'R16-' || lpad((2*g)::text,2,'0')
from generate_series(1,4) g;

-- Semis: 2 ranuras.
insert into public.matches (id, round, position, points, kickoff_at, feeder_a, feeder_b)
select
  'SF-' || g, 'SF', g, 8,
  now() + interval '11 days' + (g * interval '6 hours'),
  'QF-' || (2*g-1),
  'QF-' || (2*g)
from generate_series(1,2) g;

-- Final.
insert into public.matches (id, round, position, points, kickoff_at, feeder_a, feeder_b)
values ('F', 'F', 1, 16, now() + interval '14 days', 'SF-1', 'SF-2');

-- ----------------------------------------------------------------------------
-- CIERRE ÚNICO para TODO el cuadro (modelo "deadline global").
-- Todos los partidos se bloquean a la vez. Ajusta fecha/hora/zona horaria.
-- Ejemplo: mañana a las 19:00, hora peninsular española (CEST = UTC+2).
-- (También puedes hacerlo con un clic desde el panel de Admin de la app.)
-- ----------------------------------------------------------------------------
update public.matches set kickoff_at = '2026-06-29 19:00:00+02';

-- ============================================================================
-- 6. HAZTE ADMIN  (tras registrarte una vez en la app, ejecuta esto con tu email)
-- ============================================================================
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'TU_EMAIL@ejemplo.com');

-- Cómo poner resultados (admin):  para cada partido jugado, fija el ganador real:
--   update public.matches set actual_winner = 'Equipo 02' where id = 'R32-01';
-- La clasificación se recalcula sola.
