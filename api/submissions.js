import { list, get, del } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

const hash = s => createHash('sha256').update(String(s)).digest();

function authorized(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return 'unset';
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return timingSafeEqual(hash(given), hash(expected)) ? 'ok' : 'no';
}

function guard(request) {
  const a = authorized(request);
  if (a === 'unset') return json({ error: 'ADMIN_PASSWORD is not set in Vercel yet.' }, 503);
  if (a === 'no') return json({ error: 'Wrong password.' }, 401);
  return null;
}

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;

  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'submissions/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const items = await Promise.all(
    blobs.map(async b => {
      try {
        const r = await get(b.pathname, { access: 'private' });
        if (r?.statusCode !== 200) return null;
        const rec = JSON.parse(await new Response(r.stream).text());
        return { ...rec, pathname: b.pathname };
      } catch { return null; }
    })
  );

  const out = items.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return json({ items: out });
}

export async function DELETE(request) {
  const denied = guard(request);
  if (denied) return denied;
  const pathname = new URL(request.url).searchParams.get('pathname') || '';
  if (!/^submissions\/[\w-]+\.json$/.test(pathname)) return json({ error: 'Bad pathname.' }, 400);
  await del(pathname);
  return json({ ok: true });
}
