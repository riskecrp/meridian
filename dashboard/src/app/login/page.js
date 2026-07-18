"use client";
export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-0)' }}>
      <div className="w-full max-w-sm text-center">
        <div className="text-2xl font-black italic tracking-tighter uppercase mb-1" style={{ color: 'var(--fg-0)' }}>Meridian</div>
        <div className="text-[9px] font-bold uppercase tracking-[0.4em] mb-12" style={{ color: 'var(--fg-4)' }}>Operations Hub</div>
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
