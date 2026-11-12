import { randomUUID } from 'node:crypto';
import { json, saveJson } from './_shop.js';

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const TYPES = ['Hourly help', 'Full project'];

export async function POST(request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (d.company_url) return json({ ok: true }); // honeypot

  const rec = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    type: TYPES.includes(d.type) ? d.type : 'Hourly help',
    name: clean(d.name, 120),
    email: clean(d.email, 200).toLowerCase(),
    phone: clean(d.phone, 40),
    website: clean(d.website, 300),
    message: clean(d.message, 5000),
    sessionId: /^cs_[A-Za-z0-9_]{10,200}$/.test(d.sessionId || '') ? d.sessionId : '',
  };
  if (!rec.name) return json({ error: 'Add your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) return json({ error: 'Add a valid email address.' }, 400);
  if (rec.message.length < 10) return json({ error: 'Tell us a little more about what you need.' }, 400);

  try {
    await saveJson(`hires/${rec.createdAt.replace(/[:.]/g, '-')}-${rec.id}.json`, rec);
  } catch (e) {
    console.error('hire save failed', e);
    return json({ error: 'We could not save your request. Please email hello@vibeo.ink.' }, 500);
  }
  return json({ ok: true });
}
