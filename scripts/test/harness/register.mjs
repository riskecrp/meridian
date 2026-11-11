// `node --import scripts/test/harness/register.mjs <test>` makes 'use server'
// action files importable under plain Node: next/headers, next/cache and
// next/navigation are redirected to stubs, Discord sends become no-ops, and the
// "request" is globalThis.__cookies (set by the test). DATABASE_PATH must point
// at a throwaway database (scripts/test/run.mjs builds one).
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
if (!process.env.DATABASE_PATH) throw new Error('DATABASE_PATH must point at a throwaway test database');
process.env.DISCORD_BOT_TOKEN = '';
process.env.SESSION_SECRET ||= 'test-secret';
process.env.NOTIFY_SECRET ||= 'test-notify';
process.env.BASE_URL ||= 'http://localhost:3000';
process.env.GUILD_ID ||= '1457188814916423855';
globalThis.__cookies ||= { meridian_session: 'tok-l3' };
