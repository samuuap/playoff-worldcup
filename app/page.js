'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/useUser';
import Bracket from '@/components/Bracket';

export default function Home() {
  const { user, profile } = useUser();
  const router = useRouter();

  useEffect(() => { if (user === null) router.replace('/login'); }, [user, router]);

  if (!user) return <div className="loading">Cargando…</div>;
  return <Bracket user={user} profile={profile} />;
}
