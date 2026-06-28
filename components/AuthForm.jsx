'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthForm() {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [username, setUsername] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function go() {
    setErr('');
    if (!email || !pass) { setErr('Email y contraseña obligatorios.'); return; }
    if (signup && !username) { setErr('Elige un nombre de usuario.'); return; }
    setBusy(true);
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({ email, password: pass, options: { data: { username } } });
        if (error) throw error;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      router.replace('/');
    } catch (e) {
      setErr(e.message.includes('Email not confirmed')
        ? 'Confirma tu email (o desactiva la confirmación en Supabase → Authentication).'
        : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>{signup ? 'Crea tu cuenta' : 'Entra a la quiniela'}</h2>
      <p className="sub">Tus selecciones se guardan en tu cuenta.</p>

      {signup && (
        <div className="field">
          <label>Nombre de usuario</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="messi10" />
        </div>
      )}
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input type="password" value={pass} onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && go()} placeholder="••••••••" />
      </div>

      <div className="err">{err}</div>
      <button className="act solid" style={{ width: '100%', padding: 12 }} onClick={go} disabled={busy}>
        {busy ? '…' : signup ? 'Registrarme' : 'Entrar'}
      </button>

      <div className="switch">
        {signup ? '¿Ya tienes cuenta? ' : '¿Nuevo aquí? '}
        <a onClick={() => { setSignup(!signup); setErr(''); }}>{signup ? 'Entra' : 'Crea una cuenta'}</a>
      </div>
    </div>
  );
}
