// The "request" is a global the harness sets: globalThis.__cookies = { meridian_session: 'tok-l3', meridian_viewas: '' }
function store() {
  const jar = globalThis.__cookies || {};
  return {
    get: (name) => (jar[name] !== undefined && jar[name] !== '' ? { name, value: jar[name] } : undefined),
    getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
    has: (name) => jar[name] !== undefined,
    set: (name, value) => { jar[typeof name === 'object' ? name.name : name] = typeof name === 'object' ? name.value : value; },
    delete: (name) => { delete jar[name]; },
  };
}
export async function cookies() { return store(); }
export async function headers() { return new Map(Object.entries(globalThis.__headers || { host: 'localhost:3000' })); }
