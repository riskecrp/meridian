export function revalidatePath(p) { (globalThis.__revalidated ||= []).push(p); }
export function revalidateTag(t) { (globalThis.__revalidated ||= []).push('tag:' + t); }
export function unstable_noStore() {}
