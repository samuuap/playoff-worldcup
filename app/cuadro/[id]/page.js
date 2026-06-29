'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/lib/useUser';
import { supabase } from '@/lib/supabaseClient';
import Bracket from '@/components/Bracket';

export default function CuadroUsuarioPage() {
  const { user, profile } = useUser();
  const router = useRouter();
  const params = useParams();
  const targetId = params.id;
  const [viewUser, setViewUser] = useState(undefined); // undefined = cargando, null = no existe
  const [locked, setLocked] = useState(null);          // ¿ya cerró el cuadro?

  useEffect(() => { if (user === null) router.replace('/login'); }, [user, router]);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('id,username,late_entry_at').eq('id', targetId).single()
      .then(({ data }) => setViewUser(data || null));
    supabase.from('matches').select('kickoff_at').order('kickoff_at').limit(1)
      .then(({ data }) => setLocked(data?.[0] ? Date.now() >= new Date(data[0].kickoff_at).getTime() : false));
  }, [user, targetId]);

  if (!user || viewUser === undefined || locked === null) return <div className="loading">Cargando…</div>;
  if (!viewUser) return <div className="loading">Ese usuario no existe.</div>;

  const own = targetId === user.id;
  // Antes del cierre solo puedes ver tu propio cuadro (los ajenos están ocultos).
  if (!own && !locked) {
    return <div className="loading">El cuadro de @{viewUser.username} estará visible cuando se cierren las apuestas.</div>;
  }

  return <Bracket user={user} profile={profile} viewUser={viewUser} readOnly />;
}
