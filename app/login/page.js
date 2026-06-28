'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/useUser';
import AuthForm from '@/components/AuthForm';

export default function LoginPage() {
  const { user } = useUser();
  const router = useRouter();

  useEffect(() => { if (user) router.replace('/'); }, [user, router]);

  return <div className="center-screen"><AuthForm /></div>;
}
