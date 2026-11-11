// Which shell a person sees, and how a path maps between the two.
//
// /v2 is the current site (kept whole as the fallback); /v3 is the redesign.
// The per-person choice is the `meridian_ui` cookie; the site-wide default is
// NEXT_PUBLIC_UI_DEFAULT ('v3' unless set to 'v2'). Plain strings so the proxy
// (edge) and client components can both import this.
export const UI_COOKIE = 'meridian_ui';
export const UI_DEFAULT = (process.env.NEXT_PUBLIC_UI_DEFAULT || 'v3') === 'v2' ? 'v2' : 'v3';

/** 'v2' | 'v3' for a cookie value, falling back to the site default. */
export function pickUi(cookieValue) {
  return cookieValue === 'v2' || cookieValue === 'v3' ? cookieValue : UI_DEFAULT;
}

// v2 path (no prefix) -> v3 path. Anything not listed keeps its path under the
// other prefix. Query strings are carried over; the v3 pages accept the v2 tab ids.
const V2_TO_V3 = {
  '': '',                       // home
  '/tasks': '/work',
  '/teams': '/work?view=team',
  '/inbox': '?panel=notifications',
  '/feedback': '/comms?tab=feedback',
  '/leadership': '/reviews',
  '/leadership?tab=queue': '',
  '/leadership?tab=approvals': '?panel=queue',
  '/leadership?tab=reviews': '/reviews',
  '/leadership?tab=performance': '/reviews?tab=performance',
  '/leadership?tab=notes': '/reviews?tab=notes',
  '/leadership?tab=contacts': '/reviews?tab=contacts',
  '/notes': '/reviews?tab=notes',
  '/story': '/library',
  '/story?tab=scenelogs': '/storytelling?tab=scenelogs',
  '/story?tab=scenes': '/storytelling?tab=scenes',
  '/story?tab=changelog': '/storytelling?tab=changelog',
  '/story?tab=npcs': '/storytelling?tab=npcs',
  '/story?tab=spawner': '/storytelling?tab=spawner',
  '/admin': '/settings',
};
const V3_TO_V2 = {
  '': '',
  '/work': '/tasks',
  '/work?view=team': '/teams',
  '/reviews': '/leadership?tab=reviews',
  '/reviews?tab=performance': '/leadership?tab=performance',
  '/reviews?tab=notes': '/leadership?tab=notes',
  '/reviews?tab=contacts': '/leadership?tab=contacts',
  '/library': '/story',
  '/storytelling': '/story',
  '/settings': '/admin',
  '/comms?tab=feedback': '/feedback',
};

function splitPath(full, prefix) {
  const [path, qs = ''] = full.split('?');
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return { rest: rest.replace(/\/$/, ''), qs };
}

/** Translate /v2/... to /v3/... (or back). Dynamic routes (factions/<name>, tasks/<uid>) are handled by pattern. */
export function translatePath(full, to) {
  const from = to === 'v3' ? '/v2' : '/v3';
  const { rest, qs } = splitPath(full, from);
  const params = new URLSearchParams(qs);
  const tab = params.get('tab');
  const key = tab ? `${rest}?tab=${tab}` : rest;
  const table = to === 'v3' ? V2_TO_V3 : V3_TO_V2;
  let target = table[key] ?? table[rest];
  let m;
  if (target === undefined) {
    if ((m = rest.match(/^\/factions\/(.+)$/))) target = `/factions/${m[1]}`;
    else if ((m = rest.match(/^\/tasks\/(.+)$/))) target = to === 'v3' ? `/work/${m[1]}` : `/tasks/${m[1]}`;
    else if ((m = rest.match(/^\/work\/(.+)$/))) target = to === 'v3' ? `/work/${m[1]}` : `/tasks/${m[1]}`;
    else if ((m = rest.match(/^\/feedback\/(.+)$/))) target = `/feedback/${m[1]}`;
    else target = rest;
  }
  // Carry the remaining query over unless the target already set one.
  params.delete('tab');
  const [tPath, tQs = ''] = target.split('?');
  const out = new URLSearchParams(tQs);
  params.forEach((v, k) => { if (!out.has(k)) out.set(k, v); });
  if (tab && !tQs && table[key] === undefined) out.set('tab', tab);   // untranslated tab id passes through
  if (to === 'v2' && rest === '/storytelling' && !tab) out.set('tab', 'scenelogs');
  const q = out.toString();
  return `/${to}${tPath === '/' ? '' : tPath}${q ? `?${q}` : ''}`;
}
