import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session?.user) { setProfile(null); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) setProfileError(error.message);
    setProfile(data || null);
  }, [session?.user?.id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    profileError,
    loading: session === undefined || (session && profile === null && !profileError),
    mustChangePassword: !!session?.user?.user_metadata?.must_change_password,
    isAdmin: profile?.role === 'admin' && profile?.is_active,
    isManager: ['manager', 'admin'].includes(profile?.role) && profile?.is_active,
    reloadProfile: loadProfile,
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
