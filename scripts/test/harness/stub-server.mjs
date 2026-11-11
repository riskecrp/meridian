// next/server stub: route handlers build responses with NextResponse; under
// Node the Web Response class is enough.
export class NextResponse extends Response {
  static redirect(url, status = 307) { return new Response(null, { status, headers: { location: String(url) } }); }
  static json(data, init = {}) { return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }); }
}
