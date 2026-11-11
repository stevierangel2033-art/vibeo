import { list, get, put } from '@vercel/blob';

export const PRODUCT = {
  name: 'Build Websites That Make People Say Wow',
  description: 'The step by step Vibeo guide. 17 page PDF.',
  amount: 2200,
  currency: 'usd',
  filename: 'Vibeo - Build Websites That Make People Say Wow.pdf',
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function stripe(path, { method = 'GET', form } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('Payments are not switched on yet. Please try again soon.'), { status: 503 });
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('stripe', path, r.status, out?.error?.message);
    throw Object.assign(new Error(out?.error?.message || 'Stripe did not respond.'), { status: 502 });
  }
  return out;
}

export async function readJson(pathname) {
  try {
    const r = await get(pathname, { access: 'private', useCache: false });
    if (r?.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}

export const saveJson = (pathname, data) =>
  put(pathname, JSON.stringify(data), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });

export async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export async function productBlob() {
  const blobs = (await listAll('product/')).filter(b => /\.pdf$/i.test(b.pathname));
  blobs.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  return blobs[0] || null;
}
