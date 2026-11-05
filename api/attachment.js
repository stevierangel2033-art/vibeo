import { get } from '@vercel/blob';
import { guard, json } from './_mail.js';

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const pathname = new URL(request.url).searchParams.get('pathname') || '';
  if (!/^mail-att\/[\w-]+\/[^/]+$/.test(pathname)) return json({ error: 'Bad pathname.' }, 400);
  const r = await get(pathname, { access: 'private' });
  if (r?.statusCode !== 200) return json({ error: 'Not found.' }, 404);
  const name = pathname.split('/').pop().replace(/^\d+-/, '');
  return new Response(r.stream, {
    headers: {
      'Content-Type': r.blob.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
