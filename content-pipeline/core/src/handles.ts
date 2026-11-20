/** "@acme", "acme", "x.com/acme" or a full profile URL (with ?query or #hash) → "acme". */
export function bareHandle(h: string): string {
  const s = h.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return (/^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+\//i.test(s) ? s.split('/').pop()! : s).replace(/^@/, '');
}
