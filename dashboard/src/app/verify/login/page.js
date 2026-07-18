"use client";
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ERRORS = {
  unauthorized:  'Your Discord account is not a member of the required server.',
  oauth_failed:  'Discord authentication failed. Please try again.',
  server_error:  'An unexpected error occurred. Please try again.',
  no_code:       'Authorization was cancelled.',
};

function LoginContent() {
  const params = useSearchParams();
  const error  = params.get('error');

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-0)', fontFamily: 'Plus Jakarta Sans, sans-serif',
    }}>
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '48px 40px', maxWidth: 400, width: '100%', textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--fg-0)', marginBottom: 8 }}>
          Meridian FM
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-4)', marginBottom: 32 }}>
          Activity Verification Portal
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid var(--red)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12,
            color: 'var(--red)', marginBottom: 24, textAlign: 'left',
          }}>
            {ERRORS[error] || 'An error occurred.'}
          </div>
        )}

        <a href="/api/auth/verify" style={{
          display: 'block', background: '#5865F2', color: '#fff',
          borderRadius: 10, padding: '13px 24px', fontSize: 14, fontWeight: 700,
          textDecoration: 'none', cursor: 'pointer',
        }}>
          Login with Discord
        </a>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--fg-4)' }}>
          Requires membership in the management server.
        </div>
      </div>
    </div>
  );
}

export default function VerifyLoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
