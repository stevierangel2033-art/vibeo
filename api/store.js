import { put, del } from '@vercel/blob';
import { guard, json } from './_mail.js';
import { readJson, listAll, productBlob } from './_shop.js';

// Admin data: leads, sales and the product file
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const [leadBlobs, saleBlobs, product] = await Promise.all([listAll('leads/'), listAll('sales/'), productBlob()]);
  const [leads, sales] = await Promise.all([
    Promise.all(leadBlobs.map(b => readJson(b.pathname))),
    Promise.all(saleBlobs.map(b => readJson(b.pathname))),
  ]);
  const byDate = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);
  return json({
    leads: leads.filter(Boolean).sort(byDate),
    sales: sales.filter(Boolean).sort(byDate),
    product: product ? { pathname: product.pathname, size: product.size, uploadedAt: product.uploadedAt } : null,
    canSell: !!process.env.STRIPE_SECRET_KEY,
  });
}

// Replace the PDF people buy
export async function PUT(request) {
  const denied = guard(request);
  if (denied) return denied;
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 1000 || buf.subarray(0, 5).toString() !== '%PDF-') return json({ error: 'That file is not a PDF.' }, 400);
  if (buf.length > 4 * 1024 * 1024) return json({ error: 'Keep the PDF under 4 MB.' }, 400);
  const old = await listAll('product/');
  const saved = await put('product/guide.pdf', buf, { access: 'private', contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: true });
  const stale = old.map(b => b.pathname).filter(p => p !== saved.pathname);
  if (stale.length) await del(stale);
  return json({ ok: true, product: { pathname: saved.pathname, size: buf.length, uploadedAt: new Date().toISOString() } });
}
