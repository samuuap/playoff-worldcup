'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/useUser';
import { supabase } from '@/lib/supabaseClient';
import Header from '@/components/Header';
import { actualParticipants } from '@/lib/bracket';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

export default function AdminPage() {
  const { user, profile } = useUser();
  const router = useRouter();
  const [matches, setMatches] = useState({});
  const [order, setOrder] = useState([]);
  const [savedId, setSavedId] = useState('');
  const [err, setErr] = useState('');
  const [globalDl, setGlobalDl] = useState('');

  useEffect(() => { if (user === null) router.replace('/login'); }, [user, router]);
  useEffect(() => { if (profile && !profile.is_admin) router.replace('/'); }, [profile, router]);

  useEffect(() => {
    if (!user) return;
    supabase.from('matches').select('*').order('id').then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      const mo = {}, ord = [];
      for (const m of data) { mo[m.id] = m; ord.push(m.id); }
      setMatches(mo); setOrder(ord);
    });
  }, [user]);

  function update(id, patch) { setMatches(m => ({ ...m, [id]: { ...m[id], ...patch } })); }

  async function save(id) {
    const m = matches[id];
    const { error } = await supabase.from('matches')
      .update({ kickoff_at: m.kickoff_at, points: m.points, actual_winner: m.actual_winner || null, conditional: !!m.conditional })
      .eq('id', id);
    if (error) { setErr(error.message); return; }
    setSavedId(id); setTimeout(() => setSavedId(''), 1500);
  }

  async function applyGlobal() {
    if (!globalDl) return;
    const iso = fromLocalInput(globalDl);
    const { error } = await supabase.from('matches').update({ kickoff_at: iso }).neq('id', '');
    if (error) { setErr(error.message); return; }
    setMatches(m => { const c = {}; for (const k in m) c[k] = { ...m[k], kickoff_at: iso }; return c; });
    setSavedId('GLOBAL'); setTimeout(() => setSavedId(''), 2000);
  }

  if (!user || !profile) return <div className="loading">Cargando…</div>;
  if (!profile.is_admin) return <div className="loading">Solo para administradores.</div>;

  const rows = order.map(id => matches[id]).filter(Boolean);

  return (
    <div className="wrap">
      <Header profile={profile} />
      <div className="panel wide" style={{ margin: '0 auto' }}>
        <h2>Panel de administración</h2>
        <p className="sub">Hora de cierre, puntos (0 = el partido no computa) y resultado real. La clasificación se recalcula sola. Los rivales de cada ronda aparecen al fijar los ganadores de la ronda anterior.</p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: '4px 0 20px', padding: '12px', border: '1px solid var(--line2)', borderRadius: 12 }}>
          <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
            <label>Cierre único para TODOS los partidos</label>
            <input type="datetime-local" value={globalDl} onChange={e => setGlobalDl(e.target.value)} />
          </div>
          <button className="act solid" onClick={applyGlobal}>{savedId === 'GLOBAL' ? '✓ Aplicado' : 'Aplicar a todos'}</button>
        </div>

        {err && <div className="err-bar">{err}</div>}
        {rows.map(m => {
          const parts = actualParticipants(m, matches).filter(Boolean);
          return (
            <div className="admin-row" key={m.id}>
              <span className="id">{m.id}</span>
              <input type="datetime-local" value={toLocalInput(m.kickoff_at)}
                onChange={e => update(m.id, { kickoff_at: fromLocalInput(e.target.value) })} />
              <input type="number" min="0" value={m.points}
                onChange={e => update(m.id, { points: Number(e.target.value) })} />
              <select value={m.actual_winner || ''} onChange={e => update(m.id, { actual_winner: e.target.value || null })}>
                <option value="">— sin resultado —</option>
                {parts.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }} title="Se puntúa según el siguiente partido de ese equipo">
                <input type="checkbox" checked={!!m.conditional} onChange={e => update(m.id, { conditional: e.target.checked })} />
                cond.
              </label>
              <button className="act solid" onClick={() => save(m.id)}>{savedId === m.id ? '✓' : 'Guardar'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
