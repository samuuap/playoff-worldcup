'use client';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Header from '@/components/Header';
import {
  LAYOUT, ISO, participants, isLocked, revalidate, computeScore, countdownLabel, flagAbbr,
  deadlineOf, fmtDeadline, taintedSet,
} from '@/lib/bracket';

function Flag({ team }) {
  const [bad, setBad] = useState(false);
  if (!team) return <span className="flag q"><span className="abbr">?</span></span>;
  const code = ISO[team];
  if (!code || bad) return <span className="flag"><span className="abbr">{flagAbbr(team)}</span></span>;
  return (
    <span className="flag">
      <img src={`https://flagcdn.com/w160/${code}.png`} alt={team} onError={() => setBad(true)} />
    </span>
  );
}

export default function Bracket({ user, profile, viewUser = null, readOnly = false }) {
  // En modo lectura mostramos el cuadro de otro usuario (viewUser); si no, el propio.
  const targetId = readOnly && viewUser ? viewUser.id : user.id;
  const lateAt = readOnly && viewUser ? viewUser.late_entry_at : profile?.late_entry_at;
  const [matches, setMatches] = useState({});
  const [order, setOrder] = useState([]);
  const [picks, setPicks] = useState({});
  const [err, setErr] = useState('');
  const [, setTick] = useState(0);
  const [layoutVer, setLayoutVer] = useState(0);
  const [paths, setPaths] = useState([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [fixed, setFixed] = useState(false);
  const [saving, setSaving] = useState(false);

  const stageRef = useRef(null);
  const bracketRef = useRef(null);
  const cardRefs = useRef({});
  const fixedInit = useRef(false);

  // Carga inicial
  useEffect(() => {
    (async () => {
      const { data: ms, error: e1 } = await supabase.from('matches').select('*').order('id');
      if (e1) { setErr(e1.message); return; }
      const mo = {}, ord = [];
      for (const m of ms) { mo[m.id] = m; ord.push(m.id); }
      const { data: ps } = await supabase.from('picks').select('match_id,predicted_winner').eq('user_id', targetId);
      const pk = {}; (ps || []).forEach(p => { pk[p.match_id] = p.predicted_winner; });
      setMatches(mo); setOrder(ord); setPicks(pk);
      setLayoutVer(v => v + 1);
    })();
  }, [targetId]);

  // Reloj de cuenta atrás
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Estado inicial de "fijado" según el perfil (solo la primera vez)
  useEffect(() => {
    if (profile && !fixedInit.current) { setFixed(!!profile.picks_locked_at); fixedInit.current = true; }
  }, [profile]);

  // Recalcular conectores al cambiar tamaño / cargar banderas
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const bump = () => setLayoutVer(v => v + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(stage);
    if (bracketRef.current) ro.observe(bracketRef.current);
    window.addEventListener('resize', bump);
    const t = setTimeout(bump, 600);
    return () => { ro.disconnect(); window.removeEventListener('resize', bump); clearTimeout(t); };
  }, []);

  const computePaths = useCallback(() => {
    const stage = stageRef.current, brk = bracketRef.current;
    if (!stage || !brk) return;
    const base = stage.getBoundingClientRect();
    const pos = (id) => {
      const el = cardRefs.current[id];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left + stage.scrollLeft, y: r.top - base.top + stage.scrollTop, w: r.width, h: r.height };
    };
    const out = [];
    for (const id of order) {
      const m = matches[id];
      if (!m || m.round === 'R32') continue;
      const p = pos(id);
      if (!p) continue;
      for (const f of [m.feeder_a, m.feeder_b]) {
        const c = pos(f);
        if (!c) continue;
        let x1, x2;
        const y1 = c.y + c.h / 2, y2 = p.y + p.h / 2;
        if (c.x < p.x) { x1 = c.x + c.w; x2 = p.x; } else { x1 = c.x; x2 = p.x + p.w; }
        const mx = (x1 + x2) / 2;
        out.push({ d: `M${x1} ${y1} H${mx} V${y2} H${x2}`, on: !!picks[f] });
      }
    }
    setDims({ w: brk.scrollWidth, h: brk.scrollHeight });
    setPaths(out);
  }, [matches, order, picks]);

  useLayoutEffect(() => { computePaths(); }, [computePaths, layoutVer]);

  // Entrada tardía: el usuario fue habilitado tras el cierre. Puede editar cualquier
  // ranura cuyo resultado aún no exista, pero no puntúa las ramas ya decididas.
  const isLate = !!lateAt;
  const matchLocked = useCallback((m) => {
    if (!m) return true;
    if (isLate) return !!m.result_set_at; // tardío: bloqueado solo si ya hay resultado
    return isLocked(m);
  }, [isLate]);

  const pick = useCallback(async (matchId, team) => {
    if (readOnly) return;
    const m = matches[matchId];
    if (!m || matchLocked(m) || fixed || picks[matchId] === team) return;
    const prev = picks;
    const next = revalidate(matches, order, { ...picks, [matchId]: team });
    setPicks(next);
    setErr('');
    setSaving(true);
    const { error } = await supabase.from('picks')
      .upsert({ user_id: user.id, match_id: matchId, predicted_winner: team, updated_at: new Date().toISOString() });
    if (error) {
      setPicks(prev);
      setErr('No se pudo guardar (¿apuestas cerradas?): ' + error.message);
      setSaving(false);
      return;
    }
    const removed = Object.keys(prev).filter(k => !(k in next));
    if (removed.length) await supabase.from('picks').delete().eq('user_id', user.id).in('match_id', removed);
    setSaving(false);
  }, [matches, order, picks, user.id, fixed, matchLocked, readOnly]);

  const tainted = taintedSet(matches, order, lateAt);
  const score = computeScore(matches, order, picks, tainted);
  const deadline = deadlineOf(matches, order);
  const deadlinePassed = deadline ? Date.now() >= deadline.getTime() : false;
  // El tardío no se rige por el cierre global; cada ranura se bloquea al conocerse su resultado.
  const disabledAll = readOnly || (isLate ? fixed : (fixed || deadlinePassed));

  async function toggleFix() {
    const next = !fixed;
    const { error } = await supabase.from('profiles')
      .update({ picks_locked_at: next ? new Date().toISOString() : null })
      .eq('id', user.id);
    if (error) { setErr('No se pudo actualizar: ' + error.message); return; }
    setFixed(next);
  }

  function renderPill(m, team, idx) {
    const locked = matchLocked(m);
    const known = !!team;
    const picked = team && picks[m.id] === team;
    const isAct = m.actual_winner && team === m.actual_winner;
    let cls = 'team';
    if (picked) cls += ' picked';
    if (!known) cls += ' empty';
    if (!known || locked || disabledAll) cls += ' disabled';
    if (isAct) cls += ' actual';
    let mark = '';
    if (m.actual_winner && picked) { cls += m.actual_winner === team ? ' correct' : ' wrong'; mark = m.actual_winner === team ? '✓' : '✗'; }
    return (
      <button key={idx} className={cls} disabled={!known || locked || disabledAll} onClick={() => pick(m.id, team)}>
        <Flag team={team} />
        <span className="nm">{team || 'Por definir'}</span>
        <span className="mark">{mark}</span>
      </button>
    );
  }

  function renderMatch(id) {
    const m = matches[id];
    if (!m) return null;
    const parts = participants(m, picks);
    const cd = countdownLabel(m);
    const tag = m.round === 'F' ? 'FINAL' : m.id.replace('-', ' ');
    const dead = isLate && tainted.has(m.id);
    return (
      <div className="match" id={'card-' + m.id} key={m.id} ref={(el) => { cardRefs.current[m.id] = el; }}>
        <div className="m-top">
          <span className="m-tag" title={dead ? 'Esta rama ya estaba decidida cuando entraste: no puntúa para ti' : m.conditional ? 'Cuenta según el siguiente partido de ese equipo' : undefined}>
            {tag} · +{m.points}{m.conditional ? ' ⚡' : ''}{dead ? ' · 🚫 no puntúa' : ''}
          </span>
          <span className={'timer' + (cd.locked ? ' lock' : '')}>{cd.text}</span>
        </div>
        {parts.map((t, i) => renderPill(m, t, i))}
      </div>
    );
  }

  function renderCenter() {
    const who = picks['F'] || '';
    return (
      <div className="round center" key="center">
        <div className="champ">
          <div className="trophy">{who ? <Flag team={who} /> : '🏆'}</div>
          <div className="who">{who || '—'}</div>
          <div className="cap">{who ? 'tu campeón' : 'predice la final'}</div>
        </div>
        <div className="round-head">Final</div>
        {renderMatch('F')}
      </div>
    );
  }

  return (
    <div className="wrap">
      <Header profile={profile} score={score} />
      {err && <div className="err-bar">{err}</div>}

      {order.length > 0 && (
        <div className="banner" style={{ justifyContent: 'space-between' }}>
          {readOnly ? (
            <span>👁️ Estás viendo el cuadro de <b>@{viewUser?.username}</b> (solo lectura){isLate ? ' · entrada tardía' : ''}.</span>
          ) : isLate ? (
            <>
              <span>
                ⏱️ <b>Entrada tardía.</b> Puedes completar el cuadro, pero las ramas cuyo resultado
                ya se conocía cuando entraste <b>no te puntúan</b> (marcadas con 🚫). Sí compites por todo lo que sigue por decidir.
              </span>
              {deadline && (
                <button className="act solid" onClick={toggleFix}>{fixed ? 'Cambiar mi cuadro' : 'Fijar mis apuestas'}</button>
              )}
            </>
          ) : deadlinePassed ? (
            <span>🔒 Las apuestas están cerradas.</span>
          ) : (
            <>
              <span>
                {fixed
                  ? <>📌 Cuadro fijado. Puedes cambiarlo hasta el cierre (<b>{fmtDeadline(deadline)}</b>).</>
                  : <>🗓️ Las apuestas se cierran el <b>{fmtDeadline(deadline)}</b>. Se guarda solo; puedes fijar tu cuadro cuando quieras.</>}
              </span>
              {deadline && (
                <button className="act solid" onClick={toggleFix}>{fixed ? 'Cambiar mi cuadro' : 'Fijar mis apuestas'}</button>
              )}
            </>
          )}
        </div>
      )}

      {order.length > 0 && !readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 12, margin: '0 4px 8px', color: 'var(--muted)' }}>
          {saving
            ? <span style={{ color: 'var(--pick)' }}>⏳ Guardando…</span>
            : <span>✓ Tus cambios se guardan automáticamente</span>}
        </div>
      )}

      <div className="stage" ref={stageRef}>
        <svg className="connectors" width={dims.w} height={dims.h} style={{ width: dims.w, height: dims.h }}>
          {paths.map((p, i) => (
            <path key={i} d={p.d} fill="none" stroke={p.on ? 'rgba(79,240,180,.55)' : 'rgba(255,255,255,.16)'} strokeWidth="2" />
          ))}
        </svg>
        <div className="bracket" ref={bracketRef}>
          {LAYOUT.map((col, ci) => {
            if (col.side === 'center') return renderCenter();
            return (
              <div className={'round ' + col.side} key={ci}>
                <div className="round-head">{col.head}</div>
                {col.ids.map(id => renderMatch(id))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}