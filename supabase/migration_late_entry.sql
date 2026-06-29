-- ============================================================================
-- MIGRACIÓN: ENTRADA TARDÍA — "no se cobra por rodar al ganador ya conocido".
-- Aplícala SOLO si ya ejecutaste schema.sql antes y no quieres perder datos.
--
-- Idea: un usuario puede ser habilitado para hacer el cuadro DESPUÉS del cierre,
-- pero NO cobra una ranura donde apostó a que GANA un equipo que ya se sabía vivo
-- (con victoria registrada) cuando entró: esa información era gratis. En cambio,
-- apostar a que ese equipo PIERDE (eligiendo a su rival), o por equipos cuyo
-- destino aún no se conocía, SÍ puntúa. Así solo pierde los puntos de "rodar" al
-- ganador conocido. Puede marcar los partidos ya jugados para construir su cuadro.
-- ============================================================================

-- 1) MARCA DE ENTRADA TARDÍA en el perfil (null = jugador normal).
alter table public.profiles add column if not exists late_entry_at timestamptz;

-- 2) CUÁNDO SE FIJÓ EL RESULTADO de cada partido (para saber qué se conocía y cuándo).
alter table public.matches add column if not exists result_set_at timestamptz;

-- Sella result_set_at automáticamente cuando el admin pone/quita el resultado real.
create or replace function public.stamp_result()
returns trigger language plpgsql as $$
begin
  if new.actual_winner is distinct from old.actual_winner then
    new.result_set_at := case when new.actual_winner is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_result on public.matches;
create trigger trg_stamp_result before update on public.matches
  for each row execute function public.stamp_result();

-- Backfill: a los partidos YA resueltos les ponemos un sello "ahora".
-- (Cualquiera que entre tarde a partir de este momento los verá como ya decididos.)
update public.matches set result_set_at = now()
  where actual_winner is not null and result_set_at is null;

-- 3) RLS: un usuario tardío puede editar:
--      - cualquier ranura aún sin resultado (futuro), y
--      - las ranuras resueltas ANTES de que entrara (para construir su rama; no puntúan).
--    NO puede tocar ranuras resueltas DESPUÉS de entrar (evita cambiar el pick a posteriori).
--    El resto de usuarios mantiene la ventana normal (antes del kickoff).
drop policy if exists "picks_insert_before_kickoff" on public.picks;
create policy "picks_insert_before_kickoff" on public.picks for insert
  with check (
    auth.uid() = user_id
    and (
      now() < (select m.kickoff_at from public.matches m where m.id = match_id)
      or exists (
        select 1 from public.profiles p, public.matches m
        where p.id = auth.uid() and p.late_entry_at is not null
          and m.id = match_id
          and (m.result_set_at is null or m.result_set_at < p.late_entry_at)
      )
    )
  );

drop policy if exists "picks_update_before_kickoff" on public.picks;
create policy "picks_update_before_kickoff" on public.picks for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      now() < (select m.kickoff_at from public.matches m where m.id = match_id)
      or exists (
        select 1 from public.profiles p, public.matches m
        where p.id = auth.uid() and p.late_entry_at is not null
          and m.id = match_id
          and (m.result_set_at is null or m.result_set_at < p.late_entry_at)
      )
    )
  );

-- 4) RPC para que el ADMIN active/desactive la entrada tardía de un usuario.
create or replace function public.set_late_entry(target_user uuid, enable boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Solo un administrador puede cambiar la entrada tardía.';
  end if;
  update public.profiles
    set late_entry_at = case when enable then now() else null end
    where id = target_user;
end;
$$;
grant execute on function public.set_late_entry(uuid, boolean) to authenticated;

-- 5) CLASIFICACIÓN con bloqueo POR PARTIDO para entradas tardías.
create or replace function public.leaderboard()
returns table (user_id uuid, username text, points bigint, aciertos int, resueltos int)
language sql security definer set search_path = public as $$
  with
  parent as (
    select c.id as child_id, p.id as parent_id
    from public.matches c
    join public.matches p on (p.feeder_a = c.id or p.feeder_b = c.id)
  ),
  per_pick as (
    select
      pk.user_id,
      m.points,
      -- Contaminada: el usuario entró tarde y apostó a que GANA un equipo que ya se
      -- sabía vivo (tenía una victoria registrada) cuando entró. No se cobra por rodar
      -- al ganador conocido; apostar a que pierde (eligiendo a su rival) sí puntúa.
      (upr.late_entry_at is not null and exists (
        select 1 from public.matches kw
        where kw.actual_winner = pk.predicted_winner
          and kw.result_set_at is not null
          and kw.result_set_at < upr.late_entry_at
      )) as tainted,
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
    join public.profiles upr on upr.id = pk.user_id
    left join parent par on par.child_id = m.id
    left join public.matches pm on pm.id = par.parent_id
    left join public.picks ppk on ppk.user_id = pk.user_id and ppk.match_id = par.parent_id
  )
  select
    pr.id, pr.username,
    coalesce(sum(case when pp.is_hit and not pp.tainted then pp.points else 0 end), 0)::bigint as points,
    coalesce(count(*) filter (where pp.is_hit and not pp.tainted), 0)::int       as aciertos,
    coalesce(count(*) filter (where pp.is_resolved and not pp.tainted), 0)::int  as resueltos
  from public.profiles pr
  left join per_pick pp on pp.user_id = pr.id
  group by pr.id, pr.username
  order by points desc, aciertos desc, pr.username;
$$;
grant execute on function public.leaderboard() to authenticated;
