'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// user === undefined -> cargando ; null -> sin sesión ; objeto -> logueado
export function useUser(){
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    supabase.from('profiles').select('username,is_admin,picks_locked_at,late_entry_at').eq('id', user.id).single()
      .then(({ data }) => setProfile(data));
  }, [user]);

  return { user, profile };
}