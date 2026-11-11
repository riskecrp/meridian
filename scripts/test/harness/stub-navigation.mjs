export function redirect(url) { const e = new Error('NEXT_REDIRECT:' + url); e.code = 'NEXT_REDIRECT'; e.url = url; throw e; }
export function notFound() { const e = new Error('NEXT_NOT_FOUND'); e.code = 'NEXT_NOT_FOUND'; throw e; }
export function useRouter() { throw new Error('useRouter called outside React'); }
export function usePathname() { return '/'; }
export function useSearchParams() { return new URLSearchParams(); }
