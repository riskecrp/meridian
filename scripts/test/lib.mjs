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
// Discord capture: the actions only talk to Discord when DISCORD_BOT_TOKEN is
// set, so a case that wants to see pings sets a dummy token and replaces fetch.
// Every request is recorded as { url, method, body }; `handler(entry)` may
// return { status, json, text } (or an Error to throw) to script the answer.
export function captureDiscord(handler) {
  process.env.DISCORD_BOT_TOKEN ||= 'test-token';
  const log = [];
  globalThis.fetch = async (url, init = {}) => {
    let body; try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = init.body; }
    const entry = { url: String(url), method: init.method || 'GET', body };
    log.push(entry);
    const r = handler ? await handler(entry) : null;
    if (r instanceof Error) throw r;
    const status = r?.status ?? 200;
    const data = r?.json ?? { id: `msg${log.length}` };
    return { ok: status >= 200 && status < 300, status, clone() { return this; }, json: async () => data, text: async () => (typeof r?.text === 'string' ? r.text : JSON.stringify(data)) };
  };
  return log;
}
/** Drain the capture log and keep only channel message POSTs, summarised. */
export function pings(log) {
  const out = log.splice(0).filter(e => /\/channels\/\d+\/messages/.test(e.url) && e.method === 'POST');
  return out.map(e => ({ ch: e.url.match(/channels\/(\d+)/)[1], content: e.body?.content || '', embeds: e.body?.embeds?.length || 0, reply: !!e.body?.message_reference,
    comps: (e.body?.components?.[0]?.components || []).map(c => c.custom_id || c.label || c.url) }));
}
