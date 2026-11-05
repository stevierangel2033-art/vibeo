import { createHash, timingSafeEqual } from 'node:crypto';

export const FROM = { email: 'hello@vibeo.ink', name: 'Vibeo' };

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

const hash = s => createHash('sha256').update(String(s)).digest();

export function guard(request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json({ error: 'ADMIN_PASSWORD is not set in Vercel yet.' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(hash(given), hash(expected))) return json({ error: 'Wrong password.' }, 401);
  return null;
}

export function parseAddr(s) {
  s = String(s || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: s.toLowerCase() };
}

export const normSubject = s => String(s || '').replace(/^\s*((re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase();
export const threadKey = (email, subject) => `${String(email || '').toLowerCase()}|${normSubject(subject)}`;
export const isEmail = s => /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(String(s || '').trim());
export const stamp = iso => iso.replace(/[:.]/g, '-');
