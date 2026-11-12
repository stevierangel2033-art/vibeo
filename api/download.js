import { get } from '@vercel/blob';
import { PRODUCT, json, stripe, readJson, saveJson, productBlob } from './_shop.js';

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendEmail({ to, name, link }) {
  if (!process.env.SENDGRID_API_KEY) return false;
  const first = String(name || '').split(/\s+/)[0] || 'there';
  const text = `Hi ${first},\n\nThanks for buying ${PRODUCT.name}. Here is your download link, keep this email so you can grab it again any time:\n\n${link}\n\nStuck on your site, or want us to build it for you? Hire us by the hour or by the project:\n${link.replace('/thanks?', '/hire?')}\n\nNow go make one.\n\nVibeo\nhttps://vibeo.ink`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#000;max-width:520px">
<p style="font-size:22px;font-weight:800;margin:0 0 16px">Your guide is ready.</p>
<p>Hi ${esc(first)},</p><p>Thanks for buying <b>${esc(PRODUCT.name)}</b>. Keep this email so you can download it again any time.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#000;color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;display:inline-block">Download the PDF</a></p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e4e4e4">Stuck on your site, or want us to build it for you? <a href="${esc(link.replace('/thanks?', '/hire?'))}" style="color:#000;font-weight:700">Hire us by the hour or by the project</a>.</p><p>Now go make one.</p><p style="color:#666">Vibeo<br><a href="https://vibeo.ink" style="color:#666">vibeo.ink</a></p></div>`;
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'hello@vibeo.ink', name: 'Vibeo' },
      subject: 'Your Vibeo guide is ready',
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    }),
  });
  if (r.status !== 202) console.error('sendgrid', r.status, await r.text().catch(() => ''));
  return r.status === 202;
}

export async function GET(request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('session_id') || '';
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sid)) return json({ error: 'This download link is not valid.' }, 400);

  let session;
  try { session = await stripe('checkout/sessions/' + encodeURIComponent(sid)); }
  catch (e) { return json({ error: e.status === 503 ? e.message : 'We could not check this payment.' }, e.status || 500); }
  if (session.payment_status !== 'paid') return json({ error: 'We have not received this payment yet.' }, 402);

  const email = session.customer_details?.email || session.customer_email || '';
  const name = session.metadata?.name || session.customer_details?.name || '';

  // Record the sale once and email the buyer their link
  const salePath = `sales/${sid}.json`;
  if (!(await readJson(salePath))) {
    const link = `${url.origin}/thanks?session_id=${sid}`;
    const emailed = await sendEmail({ to: email, name, link }).catch(() => false);
    await saveJson(salePath, {
      sessionId: sid, createdAt: new Date().toISOString(), name, email,
      amount: session.amount_total, currency: session.currency, leadId: session.metadata?.lead_id || '',
      livemode: !!session.livemode, emailed,
    }).catch(e => console.error('sale save failed', e));
  }

  if (url.searchParams.get('file') !== '1') return json({ ok: true, name, email });

  const blob = await productBlob();
  if (!blob) return json({ error: 'The file is being updated. Please try again in a few minutes or email hello@vibeo.ink.' }, 503);
  const r = await get(blob.pathname, { access: 'private' });
  if (r?.statusCode !== 200) return json({ error: 'The file could not be opened. Please try again.' }, 500);
  return new Response(r.stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${PRODUCT.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
