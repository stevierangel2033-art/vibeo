import { put, del, get } from '@vercel/blob';
import { guard, json } from './_mail.js';
import { readJson, listAll, productBlob } from './_shop.js';

// Admin data: leads, sales and the product file
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  if (new URL(request.url).searchParams.get('file') === '1') {
    const blob = await productBlob();
    if (!blob) return json({ error: 'No PDF uploaded yet.' }, 404);
    const r = await get(blob.pathname, { access: 'private' });
    if (r?.statusCode !== 200) return json({ error: 'The PDF could not be opened.' }, 500);
    return new Response(r.stream, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="vibeo-guide.pdf"', 'Cache-Control': 'private, no-store' } });
  }
  const [leadBlobs, saleBlobs, hireBlobs, product] = await Promise.all([listAll('leads/'), listAll('sales/'), listAll('hires/'), productBlob()]);
  const [leads, sales, hires] = await Promise.all([
    Promise.all(leadBlobs.map(b => readJson(b.pathname))),
    Promise.all(saleBlobs.map(b => readJson(b.pathname))),
    Promise.all(hireBlobs.map(async b => { const r = await readJson(b.pathname); return r && { ...r, pathname: b.pathname }; })),
  ]);
  const byDate = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);
  return json({
    leads: leads.filter(Boolean).sort(byDate),
    sales: sales.filter(Boolean).sort(byDate),
    hires: hires.filter(Boolean).sort(byDate),
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
