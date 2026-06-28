'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function Header({ profile, score }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const link = (href, label) => (
    <Link href={href} className={'navlink' + (pathname === href ? ' active' : '')}>{label}</Link>
  );

  return (
    <header className="bar">
      <div className="brand">
        <div className="crest">Q</div>
        <div>
          <h1>Quiniela Mundial</h1>
          <small>{profile?.username ? '@' + profile.username : 'Fase eliminatoria'}</small>
        </div>
      </div>

      {score && (
        <div className="scorebug">
          <div className="stat"><span className="num pts">{score.pts}</span><span className="lbl">Puntos</span></div>
          <div className="stat"><span className="num">{score.hit}</span><span className="lbl">Aciertos</span></div>
          <div className="stat"><span className="num">{score.lock}</span><span className="lbl">Cerrados</span></div>
        </div>
      )}

      {link('/', 'Cuadro')}
      {link('/leaderboard', 'Clasificación')}
      {profile?.is_admin && link('/admin', 'Admin')}
      <button className="act" onClick={signOut}>Salir</button>
    </header>
  );
}
