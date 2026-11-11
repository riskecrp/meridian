// Node module hooks: redirect Next's request-scoped modules to stubs so
// 'use server' action files can be imported and called directly under Node.
const STUBS = {
  'next/headers': new URL('./stub-headers.mjs', import.meta.url).href,
  'next/cache': new URL('./stub-cache.mjs', import.meta.url).href,
  'next/navigation': new URL('./stub-navigation.mjs', import.meta.url).href,
  'next/server': new URL('./stub-server.mjs', import.meta.url).href,
};
export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
