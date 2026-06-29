'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/lib/useUser';
import { supabase } from '@/lib/supabaseClient';
import Header from '@/components/Header';

export default function LeaderboardPage() {
  const { user, profile } = useUser();
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { if (user === null) router.replace('/login'); }, [user, router]);

  useEffect(() => {
    if (!user) return;
    supabase.rpc('leaderboard').then(({ data, error }) => {
      if (error) setErr(error.message); else setRows(data || []);
    });
  }, [user]);

  if (!user) return <div className="loading">Cargando…</div>;

  return (
    <div className="wrap">
      <Header profile={profile} />
      <div className="panel wide" style={{ margin: '0 auto' }}>
        <h2>Clasificación</h2>
        <p className="sub">Puntos por aciertos ya resueltos. Toca un nombre para ver su cuadro.</p>
        {err && <div className="err-bar">{err}</div>}
        {!rows ? <p className="sub">Cargando…</p> : rows.map((r, i) => (
          <Link
            href={`/cuadro/${r.user_id}`}
            key={r.user_id}
            className={'lb-row' + (r.user_id === user.id ? ' me' : '')}
            style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <span className="rk">{i + 1}</span>
            <span className="nm">{r.username}{r.user_id === user.id ? ' · tú' : ''} ›</span>
            <span className="ax">{r.aciertos} ✓</span>
            <span className="pp">{r.points} pts</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
