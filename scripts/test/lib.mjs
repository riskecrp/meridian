// Tiny assertion helpers for the test cases. A failing check throws, so the
// runner marks the file failed; nothing here depends on a test framework.
export const as = (token, viewAs) => { globalThis.__cookies.meridian_session = token; if (viewAs) globalThis.__cookies.meridian_viewas = viewAs; else delete globalThis.__cookies.meridian_viewas; };
export function ok(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
export function eq(a, b, msg) { if (a !== b) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
export async function rejects(fn, code, msg) {
  try { await fn(); } catch (e) { if (code && e.code !== code) throw new Error(`FAIL: ${msg}: wrong code ${e.code}: ${e.message}`); return e; }
  throw new Error('FAIL: ' + msg + ' (did not throw)');
}
export async function failsWith(fn, re, msg) {
  const r = await fn();
  if (!r || r.ok !== false) throw new Error(`FAIL: ${msg} (expected ok:false, got ${JSON.stringify(r)})`);
  if (re && !re.test(r.error || '')) throw new Error(`FAIL: ${msg} (error "${r.error}" does not match ${re})`);
  return r;
}
export function pass(label) { console.log('  ok', label); }
