-- ============================================================================
-- MIGRACIÓN: ver el cuadro de OTROS usuarios (solo lectura) tras el cierre.
-- Aplícala si ya ejecutaste schema.sql. No borra datos.
--
-- Regla: cada pick es visible para todos cuando su partido ya cerró (kickoff_at).
-- Antes del cierre nadie ve los picks ajenos (para que no se copien).
-- ============================================================================

drop policy if exists "picks_select_after_lock" on public.picks;
create policy "picks_select_after_lock" on public.picks for select
  using (
    auth.uid() = user_id
    or now() >= (select m.kickoff_at from public.matches m where m.id = match_id)
  );

-- (La política existente "picks_select_own" puede quedarse: SELECT con varias
--  políticas permisivas se combina con OR. Si prefieres una sola, bórrala:)
-- drop policy if exists "picks_select_own" on public.picks;
