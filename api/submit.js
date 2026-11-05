import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const LIMITS = { name: 120, email: 200, company: 160, website: 300, budget: 60, timeline: 60, about: 5000, source: 200 };
const SERVICES = ['Landing page', 'Brand website', 'Online store', 'Web app', 'Redesign', 'Not sure yet'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Send the form as JSON.' }, 400); }

  // Honeypot: real people never fill this field
  if (data.company_url) return json({ ok: true });

  const entry = {};
  for (const [k, max] of Object.entries(LIMITS)) entry[k] = clean(data[k], max);
  entry.services = Array.isArray(data.services) ? data.services.filter(s => SERVICES.includes(s)) : [];

  if (!entry.name) return json({ error: 'Add your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) return json({ error: 'Add a valid email address.' }, 400);
  if (entry.about.length < 10) return json({ error: 'Tell us a little more about the project.' }, 400);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record = { id, createdAt, ...entry, userAgent: clean(request.headers.get('user-agent') || '', 300) };

  try {
    await put(`submissions/${createdAt.replace(/[:.]/g, '-')}-${id}.json`, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (err) {
    console.error('submit failed', err);
    return json({ error: 'We could not save your brief. Please email hello@vibeo.ink instead.' }, 500);
  }

  return json({ ok: true });
}
