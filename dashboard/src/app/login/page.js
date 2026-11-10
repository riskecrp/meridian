"use client";
import { useEffect, useState } from 'react';

const ERRORS = {
  no_code: 'Discord did not return a login code. Try again.',
  bad_state: 'The login link expired or was opened in a different browser. Start again from this page.',
  oauth_failed: 'Discord rejected the login. Try again.',
  not_in_server: 'You are not a member of the FM Discord server.',
  unauthorized: 'Your Discord account has no Faction Management role or dashboard access grant.',
  retired: 'This staff account has been retired. Ask leadership if that is a mistake.',
  not_configured: 'Discord login is not configured on this server (DISCORD_CLIENT_ID).',
  server_error: 'Something went wrong on the server. Try again in a minute.',
  expired: 'Your session expired. Sign in again.',
};

export default function LoginPage() {
  const [error, setError] = useState('');
  useEffect(() => {
    try { const code = new URLSearchParams(window.location.search).get('error'); if (code) setError(ERRORS[code] || 'Login failed.'); } catch {}
  }, []);
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-0)' }}>
      <div className="w-full max-w-sm text-center">
        <div className="text-2xl font-black italic tracking-tighter uppercase mb-1" style={{ color: 'var(--fg-0)' }}>Meridian</div>
        <div className="text-[9px] font-bold uppercase tracking-[0.4em] mb-12" style={{ color: 'var(--fg-4)' }}>Operations Hub</div>
        {error && (
          <div role="alert" className="mb-6 rounded-lg px-4 py-3 text-xs text-left" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }}>{error}</div>
        )}
        <a href="/api/auth/discord"
          className="inline-block w-full py-4 px-6 rounded-lg text-sm font-bold uppercase tracking-widest text-white transition-colors"
          style={{ background: '#5865F2' }}>
          Authenticate via Discord
        </a>
        <p className="text-xs mt-6 font-mono" style={{ color: 'var(--fg-4)' }}>Authorized personnel only.</p>
      </div>
    </main>
  );
}
