-- ============================================================================
-- MIGRACIÓN: regla "condicional" (un partido se puntúa según el SIGUIENTE).
-- Aplícala SOLO si ya ejecutaste schema.sql antes y no quieres perder datos.
-- (Si vas a ejecutar schema.sql desde cero, ya lo incluye; no hace falta esto.)
-- ============================================================================

-- 1) Nueva columna
alter table public.matches add column if not exists conditional boolean not null default false;

-- 2) Función de clasificación con la regla condicional
create or replace function public.leaderboard()
returns table (user_id uuid, username text, points bigint, aciertos int, resueltos int)
language sql
security definer set search_path = public
as $$
  with parent as (
    select c.id as child_id, p.id as parent_id
    from public.matches c
    join public.matches p on (p.feeder_a = c.id or p.feeder_b = c.id)
  ),
  per_pick as (
    select
      pk.user_id,
      m.points,
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

-- 3) Marcar el partido de hoy como condicional (cambia el id por el correcto).
-- update public.matches set conditional = true where id = 'R32-07';
