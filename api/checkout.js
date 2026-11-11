import { randomUUID } from 'node:crypto';
import { PRODUCT, json, stripe, saveJson } from './_shop.js';

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (data.website_url) return json({ error: 'Something went wrong.' }, 400); // honeypot

  const name = clean(data.name, 120);
  const email = clean(data.email, 200).toLowerCase();
  if (!name) return json({ error: 'Add your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Add a valid email so we can send your copy.' }, 400);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const origin = new URL(request.url).origin;

  let session;
  try {
    session = await stripe('checkout/sessions', {
      method: 'POST',
      form: {
        mode: 'payment',
        customer_email: email,
        client_reference_id: id,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': PRODUCT.currency,
        'line_items[0][price_data][unit_amount]': String(PRODUCT.amount),
        'line_items[0][price_data][product_data][name]': PRODUCT.name,
        'line_items[0][price_data][product_data][description]': PRODUCT.description,
        'metadata[lead_id]': id,
        'metadata[name]': name,
        allow_promotion_codes: 'true',
        success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/#buy`,
      },
    });
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }

  try {
    await saveJson(`leads/${createdAt.replace(/[:.]/g, '-')}-${id}.json`, {
      id, createdAt, name, email, sessionId: session.id,
      userAgent: clean(request.headers.get('user-agent') || '', 300),
    });
  } catch (e) { console.error('lead save failed', e); }

  return json({ url: session.url });
}
